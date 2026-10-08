import React, { useEffect, useId, useRef, useState, type InputHTMLAttributes } from "react";
import { supabase } from "@/lib/supabase";
import { Input } from "./ui/input";
import { AddressAttribution } from "./address-attribution";
export { AddressAttribution } from "./address-attribution";
import {
  ADDRESS_DEBOUNCE_MS, ADDRESS_MANUAL_FALLBACK, ADDRESS_MIN_CHARACTERS,
  ADDRESS_RESULT_LIMIT,
  type AddressProvenance, type AddressSuggestion, type AddressSuggestionsResponse,
} from "../../../shared/address-autocomplete";


type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onSelect"> & {
  value: string;
  onChange: (street: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
  provenance?: AddressProvenance;
};

/** Suggestions change the draft only when explicitly selected. Mount/focus never look up saved addresses. */
export function AddressAutocomplete({ value, onChange, onSelect, provenance, disabled, id, ...inputProps }: Props) {
  const generatedId = useId();
  const inputId = id || `address-${generatedId}`;
  const listId = `${inputId}-suggestions`;
  const statusId = `${inputId}-status`;
  const [query, setQuery] = useState<{ text: string; sequence: number } | null>(null);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const composing = useRef(false);
  const cancel = () => {
    ++sequence.current;
    request.current?.abort();
    setQuery(null); setSuggestions([]); setActive(-1); setBusy(false);
  };
  const typed = (next: string) => {
    cancel();
    onChange(next);
    if (!unavailable) setMessage("");
    if (!composing.current && !unavailable && next.trim().length >= ADDRESS_MIN_CHARACTERS && next.trim().length <= 250)
      setQuery({ text: next.trim(), sequence: sequence.current });
  };
  useEffect(() => {
    if (!query || disabled || unavailable) return;
    const controller = new AbortController();
    request.current = controller;
    const current = () => !controller.signal.aborted && query.sequence === sequence.current;
    const timer = window.setTimeout(async () => {
      setBusy(true);
      try {
        const { data } = await supabase.auth.getSession();
        if (!current()) return;
        if (!data.session) throw new Error("Login unavailable");
        const response = await fetch("/api/crm/customers/address-suggestions", {
          method: "POST", signal: controller.signal, cache: "no-store",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
          body: JSON.stringify({ text: query.text }),
        });
        const result: AddressSuggestionsResponse = await response.json();
        if (!current()) return;
        if (!response.ok || !result.available) {
          setSuggestions([]); setMessage(ADDRESS_MANUAL_FALLBACK);
          // Do not repeatedly hit an unconfigured/exhausted provider during this edit session.
          setUnavailable(true); return;
        }
        const next = result.suggestions.slice(0, ADDRESS_RESULT_LIMIT);
        setSuggestions(next); setActive(-1);
        setMessage(next.length ? `${next.length} suggestions. Use arrow keys and Enter to choose, or keep typing manually.` : "No suggestions found. You can enter the address manually.");
      } catch {
        if (current()) { setSuggestions([]); setMessage(ADDRESS_MANUAL_FALLBACK); }
      } finally { if (current()) setBusy(false); }
    }, ADDRESS_DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, disabled, unavailable]);

  const choose = (suggestion: AddressSuggestion) => {
    cancel(); setMessage("Address filled. Review the fields, including apartment or unit, before saving.");
    onSelect({ ...suggestion, provenance: { ...suggestion.provenance, selectedAt: new Date().toISOString() } });
  };
  const expanded = suggestions.length > 0;
  return <div className="relative min-w-0 space-y-1">
    <Input {...inputProps} id={inputId} disabled={disabled} value={value}
      role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={expanded}
      aria-controls={expanded ? listId : undefined} aria-activedescendant={active >= 0 && expanded ? `${listId}-${active}` : undefined}
      aria-describedby={[inputProps["aria-describedby"], statusId].filter(Boolean).join(" ")}
      autoComplete="off" onChange={event => typed(event.target.value)}
      onCompositionStart={() => { composing.current = true; cancel(); }}
      onCompositionEnd={event => { composing.current = false; typed(event.currentTarget.value); }}
      onBlur={event => { cancel(); inputProps.onBlur?.(event); }}
      onKeyDown={event => {
        if (event.key === "Escape" && (expanded || query || busy)) { event.preventDefault(); event.stopPropagation(); cancel(); setMessage(""); return; }
        if (!composing.current && expanded && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          setActive(index => event.key === "ArrowDown" ? (index + 1) % suggestions.length : (index <= 0 ? suggestions.length - 1 : index - 1));
        } else if (!composing.current && event.key === "Enter" && expanded) {
          // Enter while the menu is open must never accidentally submit the enclosing form.
          event.preventDefault(); if (active >= 0) choose(suggestions[active]);
        } else inputProps.onKeyDown?.(event);
      }} />
    {expanded && <div className="rounded-md border bg-popover text-popover-foreground shadow-md">
      <ul id={listId} role="listbox" aria-label="Address suggestions" className="max-h-60 overflow-y-auto py-1">
        {suggestions.map((suggestion, index) => <li key={`${suggestion.id}-${index}`} id={`${listId}-${index}`} role="option" aria-selected={active === index}
          className={`min-h-11 cursor-pointer px-3 py-2.5 text-sm break-words ${active === index ? "bg-accent text-accent-foreground" : "hover:bg-accent"}`}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(suggestion)}>
          {suggestion.label}
        </li>)}
      </ul>
      <div className="border-t px-3 py-1">{suggestions.filter((suggestion, index, values) => values.findIndex(value => JSON.stringify(value.provenance.source) === JSON.stringify(suggestion.provenance.source)) === index)
        .map(suggestion => <AddressAttribution key={suggestion.id} provenance={suggestion.provenance} />)}</div>
    </div>}
    <p id={statusId} role="status" aria-live="polite" className="text-xs text-muted-foreground">{busy ? "Looking for addresses…" : message || "Type a street address for suggestions, or enter it manually. Keep apartment or unit in its own field."}</p>
    <AddressAttribution provenance={provenance} />
  </div>;
}

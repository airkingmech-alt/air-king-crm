import { test } from "node:test";
import assert from "node:assert/strict";
import { copyAddress } from "../client/src/lib/copy-address";

test("copy uses clipboard, fallback restores selection/focus, and failures do not report success", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const address = "100 Example St, Unit #2, Test City, MO 00123";
  const navigatorWith = (value: unknown) => Object.defineProperty(globalThis, "navigator", { configurable: true, value });
  try {
    let copied = "";
    navigatorWith({ clipboard: { writeText: async (value: string) => { copied = value; } } });
    assert.equal(await copyAddress(address), true);
    assert.equal(copied, address);
    assert.equal(await copyAddress(" "), false);
    let mounted = false, restored = false, removed = false, selected = false, focused = false;
    const range = { cloneRange: () => range };
    const selection = { rangeCount: 1, getRangeAt: () => range, removeAllRanges() {}, addRange: (value: any) => { assert.equal(value, range); restored = true; } };
    const textarea = {
      value: "", readOnly: false, style: { cssText: "" },
      setAttribute() {}, focus() {}, select() { selected = true; },
      setSelectionRange(start: number, end: number) { assert.equal(start, 0); assert.equal(end, address.length); },
      remove() { removed = true; },
    };
    const dialog = { appendChild(element: any) { assert.equal(element, textarea); mounted = true; } };
    const doc = {
      activeElement: { closest: () => dialog, focus: () => { focused = true; } },
      getSelection: () => selection, createElement: () => textarea,
      body: { appendChild() { throw Error("Should mount in active dialog"); } },
      execCommand: (command: string) => { assert.equal(command, "copy"); return true; },
    };
    Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
    navigatorWith({ clipboard: { writeText: async () => { throw Error("Denied"); } } });
    assert.equal(await copyAddress(address), true);
    assert.equal(textarea.value, address);
    assert.ok(mounted && removed && selected && focused && restored);
    navigatorWith({});
    doc.execCommand = () => false;
    assert.equal(await copyAddress(address), false);
    doc.execCommand = () => { throw Error("Unsupported"); };
    assert.equal(await copyAddress(address), false);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

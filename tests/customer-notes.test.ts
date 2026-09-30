import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { PGlite } from "@electric-sql/pglite";
import WebSocket from "ws";
import {
  cacheSavedCustomerNote, customerNotesKey, customerNotesQueryOptions,
  loadCustomerNotes, saveCustomerNote, type CustomerNote,
} from "../shared/customer-notes";

const pg = new PGlite();
const company = "synthetic-company";
const note: CustomerNote = { id: "note-test", customerId: "customer-test", text: "Synthetic equipment note", author: "Test Staff", date: "2026-09-30" };
let mode = "ok";
let requests = 0;
let transaction: Promise<unknown> = Promise.resolve();

// Exercise the Supabase client over a tiny local PostgREST adapter backed by
// real PostgreSQL storage and the existing company-scoped note RLS policies.
function query(sql: string, params: any[] = [], callerCompany = company): Promise<any[]> {
  const operation = transaction.then(async () => {
    await pg.exec("begin; set local role authenticated;");
    try {
      await pg.query("select set_config('test.company_id', $1, true)", [callerCompany]);
      const result = await pg.query(sql, params);
      await pg.exec("commit");
      return result.rows;
    } catch (error) {
      await pg.exec("rollback");
      throw error;
    }
  });
  transaction = operation.catch(() => {});
  return operation;
}
const response = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchNotes: typeof fetch = async (input, init) => {
  requests++;
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  assert.equal(url.hostname, "notes-test.supabase.invalid", "Tests must never call production");
  assert.equal(url.pathname, "/rest/v1/customer_notes");
  try {
    if (init?.method === "POST") {
      if (mode === "write-error") return response({ message: "Write unavailable" }, 503);
      assert.equal(url.searchParams.get("on_conflict"), "id");
      assert.match(new Headers(init.headers).get("prefer") || "", /resolution=ignore-duplicates/);
      const row = JSON.parse(String(init.body));
      if (mode !== "silent-noop") await query(
        "insert into customer_notes(id, company_id, customer_id, text, author, date) values($1,$2,$3,$4,$5,$6) on conflict(id) do nothing",
        [row.id, row.company_id, row.customer_id, row.text, row.author, row.date],
      );
      if (mode === "write-response-lost") return response({ message: "Response interrupted" }, 503);
      return new Response(null, { status: 201 });
    }
    if (mode === "read-error") return response({ message: "Read unavailable" }, 503);
    const filters: string[] = [];
    const params: any[] = [];
    for (const field of ["company_id", "customer_id", "id"]) {
      const filter = url.searchParams.get(field);
      if (filter) {
        assert.ok(filter.startsWith("eq."));
        params.push(filter.slice(3));
        filters.push(`${field}=$${params.length}`);
      }
    }
    assert.ok(url.searchParams.has("company_id"), "Every read must be company scoped");
    assert.ok(url.searchParams.has("customer_id"), "Every read must be customer scoped");
    const rows = await query(`select id,customer_id,text,author,date from customer_notes where ${filters.join(" and ")} order by created_at desc,id desc limit $${params.length + 1} offset $${params.length + 2}`, [
      ...params, Number(url.searchParams.get("limit") || 1000), Number(url.searchParams.get("offset") || 0),
    ]);
    if (new Headers(init?.headers).get("accept")?.includes("vnd.pgrst.object")) {
      return rows.length === 1 ? response(rows[0]) : response({ message: "Expected exactly one visible saved note" }, 406);
    }
    return response(rows);
  } catch (error: any) {
    return response({ message: error.message }, 403);
  }
};
function client() {
  return createClient("https://notes-test.supabase.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchNotes }, realtime: { transport: WebSocket as any },
  });
}
before(async () => {
  const schema = await readFile("supabase/002_schema_only.sql", "utf8");
  const policies = await readFile("supabase/003_phase2_auth_rls.sql", "utf8");
  await pg.exec(`create role authenticated; ${schema.match(/create table if not exists customer_notes \([\s\S]*?\);/)![0]}
    alter table customer_notes enable row level security;
    grant select,insert,update,delete on customer_notes to authenticated;
    create function get_my_company_id() returns text language sql stable as $$select current_setting('test.company_id',true)$$;`);
  await pg.exec(policies.split("-- ---- customer_notes ----")[1].split("-- ---- customer_photos ----")[0]);
});
beforeEach(async () => { await transaction; await pg.exec("truncate customer_notes"); mode = "ok"; requests = 0; });
after(async () => { await transaction; await pg.close(); });

test("a confirmed note survives a new client/cache and an actual database reload", async () => {
  assert.deepEqual(await saveCustomerNote(client(), company, note), note);
  assert.equal((await pg.query("select * from customer_notes")).rows.length, 1);
  assert.deepEqual(await loadCustomerNotes(client(), company, note.customerId), [note]);
  assert.deepEqual(await loadCustomerNotes(client(), company, "different-customer"), []);
  assert.deepEqual(await loadCustomerNotes(client(), "other-company", note.customerId), []);
});

test("missing/denied writes and unconfirmed readbacks reject instead of reporting success", async () => {
  mode = "write-error";
  await assert.rejects(saveCustomerNote(client(), company, note), /Write unavailable/);
  assert.equal((await pg.query("select * from customer_notes")).rows.length, 0);
  mode = "silent-noop";
  await assert.rejects(saveCustomerNote(client(), company, note), /could not be verified/);
  mode = "ok";
  await assert.rejects(saveCustomerNote(client(), "other-company", note), /row-level security/);
  mode = "read-error";
  await assert.rejects(saveCustomerNote(client(), company, note), /could not be verified/);
  mode = "ok";
  assert.deepEqual(await saveCustomerNote(client(), company, note), note);
  assert.equal((await pg.query("select * from customer_notes")).rows.length, 1);
});

test("retry after a lost response returns the original persisted note exactly once", async () => {
  mode = "write-response-lost";
  await assert.rejects(saveCustomerNote(client(), company, note), /Response interrupted/);
  mode = "ok";
  assert.deepEqual(await saveCustomerNote(client(), company, { ...note, author: "Retry Staff", date: "2026-10-01" }), note);
  assert.equal((await pg.query("select * from customer_notes")).rows.length, 1);
  await assert.rejects(saveCustomerNote(client(), company, { ...note, text: "Different content" }), /could not be verified/);
  assert.deepEqual(await loadCustomerNotes(client(), company, note.customerId), [note]);
});

test("empty notes or missing company/customer never reach the database", async () => {
  for (const [scope, value] of [["", note], [company, { ...note, customerId: "" }], [company, { ...note, text: "  " }]] as const) {
    await assert.rejects(saveCustomerNote(client(), scope, value));
  }
  await assert.rejects(loadCustomerNotes(client(), "", note.customerId));
  assert.equal(requests, 0);
});

test("note loading pages beyond 500 records in stable newest-first order", async () => {
  await pg.query(`insert into customer_notes(id,company_id,customer_id,text,author,date,created_at)
    select 'note-'||n,$1,$2,'Synthetic note '||n,'Test Staff','2026-09-30',timestamp '2026-09-30' + n * interval '1 second'
    from generate_series(1,501) n`, [company, note.customerId]);
  const loaded = await loadCustomerNotes(client(), company, note.customerId);
  assert.equal(loaded.length, 501);
  assert.equal(loaded[0].id, "note-501");
  assert.equal(loaded[500].id, "note-1");
  assert.equal(requests, 2);
});

function observe(queryClient: QueryClient) {
  const observer = new QueryObserver(queryClient, customerNotesQueryOptions(client(), "staff-test", company, note.customerId));
  const loaded = new Promise<ReturnType<typeof observer.getCurrentResult>>(resolve => {
    const unsubscribe = observer.subscribe(result => { if (!result.isFetching) { unsubscribe(); resolve(result); } });
  });
  return { observer, loaded };
}
test("opening/reopening customer detail automatically loads durable notes despite global infinite cache freshness", async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, gcTime: Infinity } } });
  try {
    const first = observe(cache);
    assert.deepEqual((await first.loaded).data, []);
    first.observer.destroy();
    await saveCustomerNote(client(), company, note);
    const reopened = observe(cache);
    assert.deepEqual((await reopened.loaded).data, [note]);
    reopened.observer.destroy();
    cache.clear(); // Represents a new tab/reload with no in-memory note state.
    const reloaded = observe(cache);
    assert.deepEqual((await reloaded.loaded).data, [note]);
    reloaded.observer.destroy();
  } finally { cache.clear(); }
});

test("failed note reads remain errors and a retry fetch recovers saved notes", async () => {
  await saveCustomerNote(client(), company, note);
  const cache = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  try {
    mode = "read-error";
    const first = observe(cache);
    assert.equal((await first.loaded).isError, true);
    assert.equal(first.observer.getCurrentResult().data, undefined);
    mode = "ok";
    assert.deepEqual((await first.observer.refetch()).data, [note]);
    first.observer.destroy();
  } finally { cache.clear(); }
});

test("a late pre-save read cannot replace a confirmed note and cache keys isolate customers/users/companies", async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const key = customerNotesKey("staff-test", company, note.customerId);
  let finish!: (value: CustomerNote[]) => void;
  const request = cache.fetchQuery({ queryKey: key, queryFn: () => new Promise<CustomerNote[]>(resolve => { finish = resolve; }) }).catch(() => {});
  try {
    await cacheSavedCustomerNote(cache, "staff-test", company, note);
    finish([]);
    await request;
    assert.deepEqual(cache.getQueryData(key), [note]);
    await cacheSavedCustomerNote(cache, "staff-test", company, note);
    assert.deepEqual(cache.getQueryData(key), [note]);
    assert.equal(cache.getQueryData(customerNotesKey("another-staff", company, note.customerId)), undefined);
    assert.equal(cache.getQueryData(customerNotesKey("staff-test", "other-company", note.customerId)), undefined);
    assert.equal(cache.getQueryData(customerNotesKey("staff-test", company, "other-customer")), undefined);
  } finally { cache.clear(); }
});

test("customer detail mounts the query, shows read failures with retry, and awaits note save before success", async () => {
  const detail = await readFile("client/src/pages/customer-detail.tsx", "utf8");
  assert.match(detail, /const notesQuery = useCustomerNotes\(id \|\| ""\)/);
  assert.match(detail, /const customerNotes = notesQuery\.data \|\| \[\]/);
  assert.match(detail, /!notesQuery\.isPending && !notesQuery\.isError/);
  assert.match(detail, /Retry loading notes/);
  assert.ok(detail.indexOf("await addNote(") < detail.indexOf('title: "Note added"'));
  assert.ok(detail.indexOf('title: "Note added"') < detail.indexOf('setNoteText("")'));
});

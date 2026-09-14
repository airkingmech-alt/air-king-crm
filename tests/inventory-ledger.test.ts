import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const pg = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111";
const tech = "22222222-2222-4222-8222-222222222222";
let item: string, location: string;
async function sql(q: string, p: any[] = []): Promise<any[]> {
  return (await pg.query(q, p)).rows;
}
async function post(lines: any[], key = crypto.randomUUID(), actor = owner) {
  return sql("select inventory_post($1,$2,$3,$4) id", [
    "company",
    actor,
    key,
    { lines },
  ]);
}
const line = (q: number, kind = "Adjustment", extra = {}) => ({
  item_id: item,
  location_id: location,
  quantity_units: q,
  kind,
  notes: "Local test",
  ...extra,
});
before(async () => {
  await pg.exec(`create role anon;create role authenticated;create role service_role;
    create table profiles(id uuid primary key,company_id text,role text);
    create table customers(id text primary key,company_id text,data jsonb default '{}',updated_at timestamptz default now());
    create table work_orders(id text primary key,company_id text,customer_id text);
    create table invoices(id text primary key,company_id text,customer_id text);
    insert into profiles values('${owner}','company','owner'),('${tech}','company','technician');
    insert into customers(id,company_id) values('customer','company');
    insert into work_orders values('job','company','customer'),('foreign-job','foreign','other');`);
  await pg.exec(
    await readFile(
      "supabase/migrations/20260913183046_inventory_ledger.sql",
      "utf8",
    ),
  );
  await pg.exec(
    await readFile(
      "supabase/migrations/20260913183341_inventory_workflows.sql",
      "utf8",
    ),
  );
  await pg.exec(
    await readFile(
      "supabase/migrations/20260913184308_inventory_serialized.sql",
      "utf8",
    ),
  );
  [item, location] = await Promise.all([
    sql(
      "insert into inventory_items(company_id,name,sku,cost_cents,sale_cents) values('company','Capacitor','CAP',1250,8900) returning id",
    ).then((r) => r[0].id),
    sql(
      "insert into inventory_locations(company_id,name,type,assigned_to) values('company','Truck','Service Truck',$1) returning id",
      [tech],
    ).then((r) => r[0].id),
  ]);
});
after(() => pg.close());
test("stock posting is auditable and duplicate requests cannot post twice", async () => {
  const key = crypto.randomUUID(),
    lines = [line(5000, "Opening")];
  const first = await post(lines, key);
  assert.deepEqual(await post(lines, key), first);
  assert.equal(
    (await sql("select on_hand from inventory_stock"))[0].on_hand,
    5000,
  );
  assert.equal(
    (await sql("select count(*) n from inventory_movements"))[0].n,
    1,
  );
  await assert.rejects(post([line(6000)], key), /different details/);
});
test("batch failure rolls back every movement and operation", async () => {
  const before = await sql("select on_hand,version from inventory_stock");
  await assert.rejects(post([line(-1000), line(-90000)]), /Insufficient/);
  assert.deepEqual(
    await sql("select on_hand,version from inventory_stock"),
    before,
  );
});
test("technicians consume assigned truck stock on company jobs and preserve cost snapshots", async () => {
  await post([line(-1000, "Job Usage", { job_id: "job" })], undefined, tech);
  const [movement] = await sql(
    "select * from inventory_movements where kind='Job Usage'",
  );
  assert.equal(movement.customer_id, "customer");
  assert.equal(movement.unit_cost_cents, 1250);
  await assert.rejects(post([line(1000)], undefined, tech), /administrator/);
  await assert.rejects(
    post(
      [line(-1000, "Job Usage", { job_id: "foreign-job" })],
      undefined,
      tech,
    ),
    /Job not found/,
  );
});
test("cross-company item references and unassigned truck usage fail", async () => {
  const [foreign] = await sql(
    "insert into inventory_items(company_id,name,sku) values('other','Other','CAP') returning id",
  );
  await assert.rejects(
    post([line(1000, "Adjustment", { item_id: foreign.id })]),
    /not found/,
  );
  await sql("update inventory_locations set assigned_to=null where id=$1", [
    location,
  ]);
  await assert.rejects(
    post([line(-1000, "Job Usage", { job_id: "job" })], undefined, tech),
    /administrator/,
  );
});
test("reservations cannot be consumed by unallocated usage", async () => {
  await sql("update inventory_stock set reserved=on_hand");
  await assert.rejects(post([line(-1000)]), /Insufficient/);
  await sql("update inventory_stock set reserved=0");
});
test("serialized stock cannot bypass serial capture", async () => {
  await sql("update inventory_items set serialized=true where id=$1", [item]);
  await assert.rejects(post([line(1000)]), /serialized/);
  await sql("update inventory_items set serialized=false where id=$1", [item]);
});
test("history cannot be changed or deleted", async () => {
  await assert.rejects(
    sql("update inventory_movements set notes='changed'"),
    /permanent/,
  );
  await assert.rejects(sql("delete from inventory_operations"), /permanent/);
});
test("anonymous and authenticated clients cannot access inventory or invoke posting", async () => {
  for (const role of ["anon", "authenticated"]) {
    await pg.exec(`set role ${role}`);
    try {
      await assert.rejects(
        sql("select * from inventory_stock"),
        /permission denied/,
      );
      await assert.rejects(post([line(1000)]), /permission denied/);
    } finally {
      await pg.exec("reset role");
    }
  }
  const tables = await sql(
    "select relrowsecurity from pg_class where relname like 'inventory_%' and relkind='r'",
  );
  assert.ok(tables.every((t) => t.relrowsecurity));
});

async function workflow(body: any, key = crypto.randomUUID(), actor = owner) {
  return sql("select inventory_workflow($1,$2,$3,$4) id", [
    "company",
    actor,
    key,
    body,
  ]);
}
test("purchase orders receive partially and retries do not double receive", async () => {
  const [vendor] = await sql(
    "insert into inventory_vendors(company_id,name) values('company','Test vendor') returning id",
  );
  const id = crypto.randomUUID();
  await workflow({
    action: "create",
    document_id: id,
    kind: "Purchase Order",
    location_id: location,
    vendor_id: vendor.id,
    lines: [{ item_id: item, quantity: 20000, cost_cents: 1500 }],
  });
  await workflow({ action: "submit", document_id: id });
  await workflow({ action: "order", document_id: id });
  const [ln] = await sql(
    "select * from inventory_document_lines where document_id=$1",
    [id],
  );
  const body = {
      action: "receive",
      document_id: id,
      lines: [{ line_id: ln.id, quantity: 12000 }],
    },
    key = crypto.randomUUID();
  await workflow(body, key);
  await workflow(body, key);
  assert.equal(
    (await sql("select status from inventory_documents where id=$1", [id]))[0]
      .status,
    "Partially Received",
  );
  assert.equal(
    (
      await sql("select processed from inventory_document_lines where id=$1", [
        ln.id,
      ])
    )[0].processed,
    12000,
  );
  await assert.rejects(
    workflow({ ...body, lines: [{ line_id: ln.id, quantity: 9000 }] }),
    /exceeds/,
  );
  await workflow({ ...body, lines: [{ line_id: ln.id, quantity: 8000 }] });
  assert.equal(
    (await sql("select status from inventory_documents where id=$1", [id]))[0]
      .status,
    "Received",
  );
});
test("transfer stock stays in transit until received and preserves total stock", async () => {
  const [dest] = await sql(
    "insert into inventory_locations(company_id,name,type) values('company','Shop','Shop') returning id",
  );
  const id = crypto.randomUUID();
  const total = async () =>
    Number((await sql("select sum(on_hand) n from inventory_stock"))[0].n);
  const start = await total();
  await workflow({
    action: "create",
    document_id: id,
    kind: "Transfer",
    location_id: location,
    destination_id: dest.id,
    lines: [{ item_id: item, quantity: 3000 }],
  });
  await workflow({ action: "reserve", document_id: id });
  await workflow({ action: "pick", document_id: id });
  await workflow({ action: "dispatch", document_id: id });
  assert.equal(await total(), start);
  assert.equal(
    (
      await sql("select count(*) n from inventory_stock where location_id=$1", [
        dest.id,
      ])
    )[0].n,
    0,
  );
  await assert.rejects(
    workflow({ action: "cancel", document_id: id }),
    /Cannot cancel/,
  );
  const [ln] = await sql(
    "select id from inventory_document_lines where document_id=$1",
    [id],
  );
  await workflow({
    action: "receive",
    document_id: id,
    lines: [{ line_id: ln.id, quantity: 1000 }],
  });
  assert.equal(await total(), start);
  assert.equal(
    (
      await sql("select on_hand from inventory_stock where location_id=$1", [
        dest.id,
      ])
    )[0].on_hand,
    1000,
  );
  await workflow({
    action: "receive",
    document_id: id,
    lines: [{ line_id: ln.id, quantity: 2000 }],
  });
  assert.equal(await total(), start);
});
test("stale counts cannot overwrite intervening stock movements", async () => {
  const id = crypto.randomUUID();
  await workflow({
    action: "create",
    document_id: id,
    kind: "Count",
    location_id: location,
    lines: [{ item_id: item, quantity: 2000 }],
  });
  await post([line(1000)]);
  await assert.rejects(
    workflow({ action: "post", document_id: id }),
    /Stock changed/,
  );
});
test("truck templates set targets without changing physical stock", async () => {
  const id = crypto.randomUUID();
  const before = (
    await sql(
      "select on_hand,reserved,version from inventory_stock where item_id=$1 and location_id=$2",
      [item, location],
    )
  )[0];
  await workflow({
    action: "create",
    document_id: id,
    kind: "Template",
    location_id: location,
    lines: [{ item_id: item, quantity: 7000 }],
  });
  await workflow({
    action: "apply",
    document_id: id,
    destination_id: location,
  });
  const after = (
    await sql(
      "select on_hand,reserved,version,minimum,target from inventory_stock where item_id=$1 and location_id=$2",
      [item, location],
    )
  )[0];
  assert.deepEqual(
    {
      on_hand: after.on_hand,
      reserved: after.reserved,
      version: after.version,
    },
    before,
  );
  assert.equal(after.minimum, 7000);
  assert.equal(after.target, 7000);
});
test("allocation reserves stock without consuming until confirmed", async () => {
  const id = crypto.randomUUID(),
    before = (
      await sql("select on_hand from inventory_stock where location_id=$1", [
        location,
      ])
    )[0].on_hand;
  await workflow({
    action: "create",
    document_id: id,
    kind: "Allocation",
    location_id: location,
    job_id: "job",
    lines: [{ item_id: item, quantity: 1000 }],
  });
  await workflow({ action: "reserve", document_id: id });
  assert.equal(
    (
      await sql("select on_hand from inventory_stock where location_id=$1", [
        location,
      ])
    )[0].on_hand,
    before,
  );
  await workflow({ action: "consume", document_id: id });
  assert.equal(
    (
      await sql("select on_hand from inventory_stock where location_id=$1", [
        location,
      ])
    )[0].on_hand,
    before - 1000,
  );
  await assert.rejects(
    workflow({ action: "consume", document_id: id }),
    /not available/,
  );
});
test("serialized installs preserve separate same-model units and replay once", async () => {
  await sql(
    `update customers set data='{"properties":[{"id":"property","systems":[{"id":"legacy-system","model":"ABC","serial":"Not recorded"}]}]}' where id='customer'`,
  );
  const [equipment] = await sql(
    "insert into inventory_items(company_id,name,sku,serialized,details) values('company','Champion AC','AC',true,'{\"model\":\"ABC\",\"brand\":\"Champion\"}') returning id",
  );
  const serialAction = (body: any, key = crypto.randomUUID()) =>
    sql("select inventory_serial_action($1,$2,$3,$4)", [
      "company",
      owner,
      key,
      body,
    ]);
  for (let i = 0; i < 2; i++) {
    const id = crypto.randomUUID();
    await serialAction({
      id,
      action: "receive",
      item_id: equipment.id,
      location_id: location,
      serial: "UNIT-" + i,
    });
    const body = {
        id,
        action: "install",
        job_id: "job",
        property_id: "property",
        equipment_type: "AC",
        installed_at: "2026-09-13",
        ...(i === 0 ? { existing_system_id: "legacy-system" } : {}),
      },
      key = crypto.randomUUID();
    await serialAction(body, key);
    await serialAction(body, key);
  }
  const [customer] = await sql(
    "select data from customers where id='customer'",
  );
  assert.equal(customer.data.properties[0].systems.length, 2);
  assert.equal(customer.data.properties[0].systems[0].id, "legacy-system");
  assert.notEqual(
    customer.data.properties[0].systems[0].serial,
    customer.data.properties[0].systems[1].serial,
  );
  assert.equal(
    (
      await sql("select on_hand from inventory_stock where item_id=$1", [
        equipment.id,
      ])
    )[0].on_hand,
    0,
  );
});

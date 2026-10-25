import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { buildSupplierMaterialsRows } from "../shared/supplier-materials-import";

// Local preparation only. Keep supplier manifests and generated SQL outside the repository.
const [manifestPath, companyId, outputDir] = process.argv.slice(2);
if (!manifestPath || !companyId || !outputDir) throw new Error("Usage: prepare-supplier-import.ts manifest.json company-id output-dir");
const destination = resolve(outputDir);
if (destination.startsWith(resolve(".") + "/") || destination.startsWith(resolve(".") + "\\")) throw new Error("Write supplier account data outside the repository.");
const rows = buildSupplierMaterialsRows(JSON.parse(await readFile(manifestPath, "utf8")), companyId);
await mkdir(destination, {recursive:true});
await writeFile(resolve(destination,"database-rows.json"),JSON.stringify(rows,null,2));
const columns="company_id,item_type,category,name,description,sku,brand,model,unit,cost_cents,price_cents,taxable,active,metadata";
const record="company_id text,item_type text,category text,name text,description text,sku text,brand text,model text,unit text,cost_cents integer,price_cents integer,taxable boolean,active boolean,metadata jsonb";
const quote=(text:string)=>"'"+text.replace(/'/g,"''")+"'";
for (let offset=0;offset<rows.length;offset+=70) {
  const chunk=rows.slice(offset,offset+70);
  const payload=JSON.stringify(chunk);
  const tag="$airking_materials$";
  if(payload.includes(tag))throw new Error("Unexpected dollar quote in manifest.");
  const sql=`with source as (select * from jsonb_to_recordset(${tag}${payload}${tag}::jsonb) as r(${record})), inserted as (insert into public.price_book_items (${columns}) select ${columns} from source where company_id=${quote(companyId)} on conflict do nothing returning sku) select count(*)::int as inserted from inserted;`;
  await writeFile(resolve(destination,`import-${Math.floor(offset/70)+1}.sql`),sql);
}
const skus=rows.map(row=>quote(row.sku.toLowerCase())).join(",");
await writeFile(resolve(destination,"preflight.sql"),`select sku,name,category,metadata->>'supplier' as supplier from public.price_book_items where company_id=${quote(companyId)} and lower(sku) in (${skus});`);
console.log(JSON.stringify({rows:rows.length,priced:rows.filter(row=>row.metadata.price_status==="priced").length,price_needed:rows.filter(row=>row.metadata.price_status==="missing").length,batches:Math.ceil(rows.length/70),source_hash:rows[0].metadata.source_sha256,batch:rows[0].metadata.import_batch}));

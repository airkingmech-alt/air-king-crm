import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mapMetaLead, verifyMetaSignature } from "../server/crm/meta-leads";

test("Meta signature validation rejects changed payloads", () => {
  const body = Buffer.from('{"object":"page"}');
  const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
  assert.equal(verifyMetaSignature(body, signature, "secret"), true);
  assert.equal(verifyMetaSignature(Buffer.from("changed"), signature, "secret"), false);
});

test("Meta lead fields map into the CRM lead model", () => {
  const mapped = mapMetaLead({
    id: "lead-123",
    created_time: "2026-09-15T03:00:00Z",
    field_data: [
      { name: "full_name", values: ["Colton Nichols"] },
      { name: "phone_number", values: ["8165196067"] },
      { name: "email", values: ["test@example.com"] },
      { name: "zip_code", values: ["64493"] },
      { name: "service_needed", values: ["Seasonal maintenance"] },
      { name: "preferred_time", values: ["Morning"] },
    ],
  }, { page_id: "page-1", form_id: "form-1", campaign_id: "campaign-1" });
  assert.equal(mapped.name, "Colton Nichols");
  assert.equal(mapped.phone, "8165196067");
  assert.equal(mapped.postal_code, "64493");
  assert.equal(mapped.service_type, "Seasonal maintenance");
  assert.equal(mapped.source_ref, "lead-123");
  assert.match(mapped.message, /preferred time: Morning/);
  assert.equal(mapped.metadata.form_id, "form-1");
});

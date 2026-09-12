import { test } from "node:test";
import assert from "node:assert/strict";
import { MARKETING_RELEASE_READY, requireMarketingRelease } from "../server/crm/marketing-readiness";
import { deliver } from "../server/crm/delivery";

test("marketing has a separate fail-closed release switch", () => {
  assert.equal(MARKETING_RELEASE_READY, false);
  assert.throws(requireMarketingRelease, /sending is locked/);
});

test("preview campaign delivery does not access a provider or database", async () => {
  let calls = 0;
  await deliver({campaign_id:"preview"}, async () => { calls++; return "must-not-send"; });
  assert.equal(calls, 0);
});

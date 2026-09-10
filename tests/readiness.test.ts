import { test } from "node:test";
import assert from "node:assert/strict";
import {
  smsConfigured,
  requireSmsForChannels,
  requireAutomationProviders,
} from "../server/crm/readiness";

test("missing Twilio blocks text and combined requests before either message is queued", () => {
  assert.equal(smsConfigured({}), false);
  assert.throws(
    () => requireSmsForChannels(["sms"], {}),
    /Texting is not set up/,
  );
  assert.throws(
    () => requireSmsForChannels(["email", "sms"], {}),
    /Texting is not set up/,
  );
  assert.doesNotThrow(() => requireSmsForChannels(["email"], {}));
});
test("SMS automations can be saved disabled and cannot turn on before setup", () => {
  assert.doesNotThrow(() =>
    requireAutomationProviders(
      { enabled: false, steps: [{ action: "sms" }] },
      {},
    ),
  );
  assert.throws(
    () =>
      requireAutomationProviders(
        { enabled: true, steps: [{ action: "sms" }] },
        {},
      ),
    /Texting is not set up/,
  );
  assert.doesNotThrow(() =>
    requireAutomationProviders(
      { enabled: true, steps: [{ action: "email" }] },
      {},
    ),
  );
});
test("all three Twilio settings are needed to unlock texting", () => {
  const env = {
    TWILIO_ACCOUNT_SID: "test-only",
    TWILIO_AUTH_TOKEN: "test-only",
    TWILIO_MESSAGING_SERVICE_SID: "test-only",
  };
  assert.equal(smsConfigured(env), true);
  for (const key of Object.keys(env))
    assert.equal(smsConfigured({ ...env, [key]: "" }), false);
  assert.doesNotThrow(() => requireSmsForChannels(["sms"], env));
});

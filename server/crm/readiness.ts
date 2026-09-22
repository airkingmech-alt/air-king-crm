import { smsProvider, sentReady } from "./sentdm";
// Provider setup is independent: payments never require a messaging account.
export function smsConfigured(env: NodeJS.ProcessEnv = process.env) {
  if (smsProvider(env) === "sentdm") return sentReady(env);
  if (smsProvider(env) !== "twilio") return false;
  return Boolean(
    env.TWILIO_ACCOUNT_SID &&
      env.TWILIO_AUTH_TOKEN &&
      env.TWILIO_MESSAGING_SERVICE_SID,
  );
}

export function requireSmsForChannels(
  channels: string[],
  env: NodeJS.ProcessEnv = process.env,
) {
  if (channels.includes("sms") && !smsConfigured(env)) {
    throw new Error(
      "Texting is not set up yet. Complete the SMS provider setup in Integrations before sending texts.",
    );
  }
}

export function requireAutomationProviders(
  automation: { enabled: boolean; steps: { action: string }[] },
  env: NodeJS.ProcessEnv = process.env,
) {
  if (automation.enabled)
    requireSmsForChannels(
      automation.steps.map((step) => step.action),
      env,
    );
}

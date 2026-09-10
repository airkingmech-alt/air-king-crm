import { supabase } from "./supabase";
export async function crm(
  path: string,
  method = "GET",
  body?: unknown,
  idempotencyKey?: string,
) {
  const { data } = await supabase.auth.getSession();
  const response = await fetch("/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(data.session
        ? { Authorization: "Bearer " + data.session.access_token }
        : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Unable to complete this request.");
  return result;
}

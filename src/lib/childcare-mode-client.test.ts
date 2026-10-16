import assert from "node:assert/strict";
import test from "node:test";

import { ChildcareConfirmationDeclinedError, fetchWithChildcareConfirmation } from "./childcare-mode-client";

test("a stale client prompts on the authoritative guard and a dismissal never retries", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: string; body: unknown }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), body: init?.body });
    return Response.json({ error: "confirm", code: "CHILDCARE_CONFIRMATION_REQUIRED" }, { status: 409 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      fetchWithChildcareConfirmation("/api/activities", { method: "POST", body: JSON.stringify({ requestId: "same-id", value: 1 }) }, () => false),
      ChildcareConfirmationDeclinedError,
    );
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an accepted authoritative prompt retries the exact JSON command with only the override added", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ input: string; body: unknown }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), body: init?.body });
    return calls.length === 1
      ? Response.json({ error: "confirm", code: "CHILDCARE_CONFIRMATION_REQUIRED" }, { status: 409 })
      : Response.json({ ok: true });
  }) as typeof fetch;
  try {
    const response = await fetchWithChildcareConfirmation(
      "/api/sick-mode",
      { method: "POST", body: JSON.stringify({ requestId: "same-id", doseText: "2 ml" }) },
      () => true,
    );
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.deepEqual(JSON.parse(String(calls[1].body)), { requestId: "same-id", doseText: "2 ml", childcareOverride: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

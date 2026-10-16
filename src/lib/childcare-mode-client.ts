import { CHILDCARE_CONFIRMATION_REQUIRED } from "./childcare-mode-contract";

export class ChildcareConfirmationDeclinedError extends Error {
  constructor() {
    super("Childcare activity confirmation declined");
    this.name = "ChildcareConfirmationDeclinedError";
  }
}

export async function fetchWithChildcareConfirmation(
  input: string,
  init: RequestInit,
  confirmEntry: () => boolean,
): Promise<Response> {
  const first = await fetch(input, init);
  if (first.status !== 409) return first;
  const payload = await first.clone().json().catch(() => null) as { code?: unknown } | null;
  if (payload?.code !== CHILDCARE_CONFIRMATION_REQUIRED) return first;
  if (!confirmEntry()) throw new ChildcareConfirmationDeclinedError();

  let retryInput = input;
  let retryBody = init.body;
  if (typeof retryBody === "string") {
    const parsed = JSON.parse(retryBody) as Record<string, unknown>;
    retryBody = JSON.stringify({ ...parsed, childcareOverride: true });
  } else {
    const url = new URL(input, window.location.origin);
    url.searchParams.set("childcareOverride", "true");
    retryInput = `${url.pathname}${url.search}`;
  }
  return fetch(retryInput, { ...init, body: retryBody });
}

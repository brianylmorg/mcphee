import type { ChildcareSessionSummary } from "./childcare-mode-contract";

export type CaretakerCareWindow = {
  startedAt: number | null;
  endedAt: number | null;
  linked: boolean;
};

/**
 * Linked imports must retain the session's exact millisecond bounds. The time
 * labels shown in the review UI only have minute precision and must never be
 * round-tripped into the server request.
 */
export function resolveCaretakerCareWindow(
  session: ChildcareSessionSummary | null,
  enteredStartedAt: number | null,
  enteredEndedAt: number | null,
): CaretakerCareWindow {
  if (session?.checkedOutAt != null) {
    return {
      startedAt: session.checkedInAt,
      endedAt: session.checkedOutAt,
      linked: true,
    };
  }

  return {
    startedAt: enteredStartedAt,
    endedAt: enteredEndedAt,
    linked: false,
  };
}

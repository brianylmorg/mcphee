export type ChildcareSessionSummary = {
  id: string;
  babyId: string;
  checkedInAt: number;
  checkedOutAt: number | null;
  pendingImport: boolean;
  importBatchId: string | null;
  importCompletedAt: number | null;
};

export type ChildcareModeState = {
  schemaReady: boolean;
  activeSession: ChildcareSessionSummary | null;
  pendingSessions: ChildcareSessionSummary[];
};

export type ChildcareModeCommandResponse = ChildcareModeState & {
  session: ChildcareSessionSummary;
  idempotent: boolean;
};

export const CHILDCARE_CONFIRMATION_REQUIRED = "CHILDCARE_CONFIRMATION_REQUIRED";

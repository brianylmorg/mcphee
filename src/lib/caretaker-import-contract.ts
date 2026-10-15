export const CARETAKER_IMPORT_MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const CARETAKER_IMPORT_MAX_REQUEST_BYTES = 4_400_000;
export const CARETAKER_IMPORT_MAX_JSON_BYTES = 128 * 1024;
export const CARETAKER_IMPORT_MAX_OCR_LINES = 250;
export const CARETAKER_IMPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const CARETAKER_IMPORT_LOW_CONFIDENCE = 0.82;

export const CARETAKER_IMPORT_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type CaretakerImportImageType = (typeof CARETAKER_IMPORT_IMAGE_TYPES)[number];
export type CaretakerOriginClassification = "caretaker" | "household" | "uncertain";

export type CaretakerOcrBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CaretakerOriginEvidence = {
  classification: CaretakerOriginClassification;
  confidence: number;
  blueRatio?: number;
  evidence?: string;
};

export type CaretakerOcrLine = {
  id: string;
  text: string;
  confidence: number;
  bounds: CaretakerOcrBounds;
  origin: CaretakerOriginEvidence;
};

export type CaretakerActivityType = "bottlefeed" | "diaper" | "sleep" | "note";
export type CaretakerRowStatus =
  | "staged"
  | "needs_review"
  | "reviewed"
  | "skipped"
  | "blue_excluded"
  | "duplicate"
  | "conflict"
  | "committed";

export type CaretakerImportIssueCode =
  | "LOW_CONFIDENCE"
  | "ORIGIN_UNCERTAIN"
  | "SOURCE_HOUSEHOLD"
  | "MISSING_TIME"
  | "MISSING_END"
  | "INVALID_TIME"
  | "INVALID_DETAILS"
  | "NAP_OVERLAP"
  | "EXACT_DUPLICATE"
  | "ACTIVITY_CONFLICT"
  | "UNSUPPORTED_LAYOUT";

export type CaretakerImportIssue = {
  code: CaretakerImportIssueCode;
  message: string;
  blocking: boolean;
};

export type CaretakerActivityDraft = {
  type: CaretakerActivityType;
  startedAt: number;
  endedAt: number | null;
  details: Record<string, unknown>;
  note: string | null;
};

export type CaretakerImportRow = {
  id: string;
  rowIndex: number;
  status: CaretakerRowStatus;
  sourceLineIds: string[];
  sourceText: string;
  confidence: number;
  origin: CaretakerOriginClassification;
  originEvidence: CaretakerOriginEvidence[];
  draft: CaretakerActivityDraft;
  issues: CaretakerImportIssue[];
  exclusionReason: string | null;
  duplicateActivityId: string | null;
  conflictActivityId: string | null;
  canInclude: boolean;
  lowConfidenceConfirmed: boolean;
};

export type CaretakerSleepCoverage = {
  startedAt: number;
  endedAt: number;
};

export type CaretakerSleepReviewInput = CaretakerSleepCoverage & {
  napsChecked: true;
};

export type CaretakerSleepReconciliationSummary = {
  coverage: CaretakerSleepCoverage;
  authoritativeNapCount: number;
  retainedExactCount: number;
  removedCount: number;
  trimmedCount: number;
  splitCount: number;
  insertedCount: number;
};

export type CaretakerSleepReconciliationPreview = CaretakerSleepReconciliationSummary & {
  napsChecked: boolean;
  napSectionDetected: boolean;
  fingerprint: string;
};

export type CaretakerImportBatch = {
  id: string;
  babyId: string;
  selectedDate: string;
  status: "staged" | "committed" | "expired";
  revision: number;
  createdAt: number;
  expiresAt: number;
  committedAt: number | null;
  sourceAvailable: boolean;
  sourceMime: CaretakerImportImageType | null;
  sleepCoverage: CaretakerSleepCoverage | null;
  napSectionDetected: boolean;
};

export type CaretakerImportSnapshot = {
  schemaReady: true;
  batch: CaretakerImportBatch;
  rows: CaretakerImportRow[];
  sleepReconciliation: CaretakerSleepReconciliationPreview | null;
};

export type CaretakerStageResponse = CaretakerImportSnapshot & { idempotent: boolean };

export type CaretakerReviewRowInput = {
  id: string;
  action: "include" | "exclude";
  type?: CaretakerActivityType;
  startedAt?: number;
  endedAt?: number | null;
  details?: Record<string, unknown>;
  note?: string | null;
  confirmLowConfidence?: boolean;
  resolvedOrigin?: "caretaker" | "household";
};

export type CaretakerReviewRequest = {
  batchId: string;
  expectedRevision: number;
  rows: CaretakerReviewRowInput[];
  sleepCoverage: CaretakerSleepReviewInput;
};

export type CaretakerCommitRequest = {
  batchId: string;
  requestId: string;
  expectedRevision: number;
};

export type CaretakerCommitResponse = {
  batchId: string;
  committedActivityIds: string[];
  committedCount: number;
  idempotent: boolean;
  sleepReconciliation?: CaretakerSleepReconciliationSummary;
};

export type CaretakerImportError = {
  error: string;
  code: string;
  issues?: CaretakerImportIssue[];
};

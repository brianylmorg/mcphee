"use client";

import {
  AlertTriangle,
  Baby,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ImageUp,
  LoaderCircle,
  Milk,
  Moon,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  UtensilsCrossed,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  CARETAKER_IMPORT_IMAGE_TYPES,
  CARETAKER_IMPORT_LOW_CONFIDENCE,
  CARETAKER_IMPORT_MAX_IMAGE_BYTES,
  type CaretakerCommitResponse,
  type CaretakerImportError,
  type CaretakerImportRow,
  type CaretakerImportSnapshot,
  type CaretakerOcrLine,
  type CaretakerReviewRowInput,
  type CaretakerStageResponse,
} from "@/lib/caretaker-import-contract";
import {
  recognizeCaretakerScreenshot,
  type CaretakerOcrProgress,
} from "@/lib/caretaker-import-client";

type View = "select" | "scanning" | "review" | "success";
type RowAction = "include" | "exclude";

type ReviewDraft = {
  action: RowAction;
  type: CaretakerImportRow["draft"]["type"];
  startedAt: string;
  endedAt: string;
  amount: string;
  milkType: string;
  peeUnits: string;
  poop: string;
  note: string;
  resolvedOrigin: "" | "caretaker" | "household";
  confirmLowConfidence: boolean;
};

type StageAttempt = {
  signature: string;
  requestId: string;
  file: File;
  date: string;
  lines: CaretakerOcrLine[] | null;
};

type CommitAttempt = {
  signature: string;
  requestId: string;
};

class CaretakerRequestError extends Error {
  status: number;
  code: string;
  issues: CaretakerImportError["issues"];

  constructor(status: number, payload: CaretakerImportError) {
    super(payload.error || "Something went wrong. Try again.");
    this.name = "CaretakerRequestError";
    this.status = status;
    this.code = payload.code || "UNKNOWN";
    this.issues = payload.issues;
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null) as T | CaretakerImportError | null;
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload
      ? payload as CaretakerImportError
      : { error: "Something went wrong. Try again.", code: "UNKNOWN" };
    throw new CaretakerRequestError(response.status, error);
  }
  return payload as T;
}

function singaporeDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function singaporeDateTimeInput(timestamp: number | null): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function parseSingaporeDateTime(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}:00+08:00`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function detailsNumber(details: Record<string, unknown>, key: string): string {
  const value = details[key];
  return typeof value === "number" || typeof value === "string" ? String(value) : "";
}

function defaultAction(row: CaretakerImportRow): RowAction {
  if (row.origin === "household" || row.status === "blue_excluded") return "exclude";
  if (["skipped", "duplicate", "conflict", "committed"].includes(row.status)) return "exclude";
  if (row.issues.some(issue => issue.code === "EXACT_DUPLICATE" || issue.code === "ACTIVITY_CONFLICT")) return "exclude";
  return "include";
}

function draftFromRow(row: CaretakerImportRow): ReviewDraft {
  const details = row.draft.details;
  const milkType = typeof details.milkType === "string" ? details.milkType : "";
  const poop = typeof details.poop === "string" ? details.poop : "no";
  const note = row.draft.note ?? (typeof details.notes === "string" ? details.notes : "");
  const sourceTimeMissing = row.issues.some(issue => issue.code === "MISSING_TIME");
  return {
    action: defaultAction(row),
    type: row.draft.type,
    startedAt: sourceTimeMissing ? "" : singaporeDateTimeInput(row.draft.startedAt),
    endedAt: singaporeDateTimeInput(row.draft.endedAt),
    amount: detailsNumber(details, "amount"),
    milkType,
    peeUnits: detailsNumber(details, "peeUnits") || detailsNumber(details, "peeSize") || (row.draft.type === "diaper" ? "3" : ""),
    poop,
    note,
    resolvedOrigin: row.origin === "uncertain" ? "" : row.origin,
    confirmLowConfidence: row.lowConfidenceConfirmed,
  };
}

function draftsFromSnapshot(snapshot: CaretakerImportSnapshot): Record<string, ReviewDraft> {
  return Object.fromEntries(snapshot.rows.map(row => [row.id, draftFromRow(row)]));
}

function isLowConfidence(row: CaretakerImportRow): boolean {
  return row.confidence < CARETAKER_IMPORT_LOW_CONFIDENCE || row.issues.some(issue => issue.code === "LOW_CONFIDENCE");
}

function localBlockingIssues(row: CaretakerImportRow, draft: ReviewDraft, selectedDate: string): string[] {
  if (draft.action === "exclude") return [];
  const issues: string[] = [];
  const startedAt = parseSingaporeDateTime(draft.startedAt);
  if (startedAt == null) issues.push("Add a valid start time.");
  else if (!draft.startedAt.startsWith(`${selectedDate}T`)) issues.push("The start time must be on the selected date.");
  if (row.origin === "uncertain" && !draft.resolvedOrigin) issues.push("Choose who entered this source row.");
  if (draft.resolvedOrigin === "household") issues.push("Household entries must stay excluded.");
  if (isLowConfidence(row) && !draft.confirmLowConfidence) issues.push("Confirm this row against the screenshot.");
  if (draft.note.length > 500) issues.push("Keep the note to 500 characters or fewer.");

  if (draft.type === "bottlefeed") {
    if (!(Number(draft.amount) > 0)) issues.push("Enter the amount consumed.");
    if (draft.milkType !== "breastmilk" && draft.milkType !== "formula") issues.push("Choose a milk type.");
  } else if (draft.type === "sleep") {
    const endedAt = parseSingaporeDateTime(draft.endedAt);
    if (endedAt == null) issues.push("Add a valid nap end time or exclude this row.");
    else if (startedAt != null && endedAt <= startedAt) issues.push("Nap end time must be after its start.");
  } else if (draft.type === "diaper") {
    const peeUnits = Number(draft.peeUnits);
    const validPeeUnits = Number.isInteger(peeUnits) && peeUnits >= 0 && peeUnits <= 5;
    const hasWet = validPeeUnits && peeUnits > 0;
    const hasPoop = Boolean(draft.poop && draft.poop !== "no");
    if (!validPeeUnits) {
      issues.push("Pee units must be a whole number from 0 to 5.");
    } else if (!hasWet && !hasPoop) {
      issues.push("Add the diaper contents.");
    }
  } else if (!draft.note.trim()) {
    issues.push("Add the solids or care note.");
  }
  return issues;
}

function reviewInput(row: CaretakerImportRow, draft: ReviewDraft): CaretakerReviewRowInput {
  if (draft.action === "exclude") return { id: row.id, action: "exclude" };
  const details = draft.type === row.draft.type ? { ...row.draft.details } : {};
  if (draft.type === "bottlefeed") {
    details.amount = Number(draft.amount);
    details.milkType = draft.milkType;
  } else if (draft.type === "diaper") {
    details.peeUnits = Number(draft.peeUnits);
    details.poop = draft.poop || "no";
  }
  if (draft.note.trim()) details.notes = draft.note.trim();
  else delete details.notes;
  return {
    id: row.id,
    action: "include",
    type: draft.type,
    startedAt: parseSingaporeDateTime(draft.startedAt) ?? undefined,
    endedAt: draft.type === "sleep" ? parseSingaporeDateTime(draft.endedAt) : null,
    details,
    note: draft.note.trim() || null,
    confirmLowConfidence: isLowConfidence(row) ? draft.confirmLowConfidence : undefined,
    resolvedOrigin: row.origin === "uncertain" && draft.resolvedOrigin ? draft.resolvedOrigin : undefined,
  };
}

function rowLabel(type: ReviewDraft["type"]): string {
  if (type === "bottlefeed") return "Feed";
  if (type === "sleep") return "Nap";
  if (type === "diaper") return "Diaper";
  return "Solids / note";
}

// Formats the draft's existing Singapore-local datetime string ("YYYY-MM-DDTHH:mm") for display.
function draftClock(draftValue: string, selectedDate: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(draftValue);
  if (!match) return "";
  const [, date, time] = match;
  return date === selectedDate ? time : `${date} ${time}`;
}

function rowSummaryParts(draft: ReviewDraft, selectedDate: string): string[] {
  const parts: string[] = [];
  const startedAt = draftClock(draft.startedAt, selectedDate);
  if (draft.type === "sleep") {
    parts.push(startedAt ? `Start ${startedAt}` : "Start time missing");
    const endedAt = draftClock(draft.endedAt, selectedDate);
    parts.push(endedAt ? `End ${endedAt}` : "End time missing");
  } else {
    parts.push(startedAt || "Time missing");
  }

  if (draft.type === "bottlefeed") {
    parts.push(draft.amount ? `${draft.amount} ml` : "Amount missing");
    parts.push(draft.milkType === "breastmilk" ? "Breastmilk" : draft.milkType === "formula" ? "Formula" : "Milk type missing");
  } else if (draft.type === "diaper") {
    parts.push(draft.peeUnits ? `${draft.peeUnits} pee units` : "Pee units missing");
    if (draft.poop === "M") parts.push("Medium poop");
    else if (draft.poop === "L") parts.push("Large poop");
    else if (draft.poop === "yes") parts.push("Poop shown, size not given");
    else parts.push("No poop shown");
  } else if (draft.type === "note") {
    const note = draft.note.replace(/\s+/g, " ").trim();
    parts.push(note ? (note.length > 48 ? `${note.slice(0, 47)}…` : note) : "Note missing");
  }

  return parts;
}

function SectionHeading({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 font-display text-base font-semibold text-warm-brown">
      <span className="text-accent-strong">{icon}</span>{children}
    </h3>
  );
}

function ReviewRowCard({
  row,
  draft,
  selectedDate,
  disabled,
  onChange,
}: {
  row: CaretakerImportRow;
  draft: ReviewDraft;
  selectedDate: string;
  disabled: boolean;
  onChange: (change: Partial<ReviewDraft>) => void;
}) {
  const localIssues = localBlockingIssues(row, draft, selectedDate);
  const included = draft.action === "include";
  const duplicate = row.status === "duplicate" || row.issues.some(issue => issue.code === "EXACT_DUPLICATE");
  const conflict = row.issues.some(issue => issue.code === "ACTIVITY_CONFLICT");
  const missingOrOverlap = row.issues.some(issue => ["MISSING_END", "NAP_OVERLAP"].includes(issue.code));
  const needsAttention = included && (
    localIssues.length > 0
    || row.issues.some(issue => issue.blocking)
    || row.origin === "uncertain"
    || isLowConfidence(row)
  );
  const [editingOpen, setEditingOpen] = useState(needsAttention);
  const summaryParts = rowSummaryParts(draft, selectedDate);
  if (draft.type === "diaper" && draft.peeUnits === "3" && row.draft.details.peeUnitsSource) {
    summaryParts[1] += " (Wet default)";
  }

  return (
    <article className={`rounded-xl border p-3 ${included ? "border-terracotta/35 bg-surface" : "border-border bg-surface-muted/45"}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={included}
          disabled={disabled || duplicate}
          aria-label={`Include ${rowLabel(draft.type)} row ${row.rowIndex + 1}`}
          onChange={event => onChange({ action: event.target.checked ? "include" : "exclude" })}
          className="mt-1 h-5 w-5 shrink-0 accent-terracotta-dark"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-warm-brown">{rowLabel(draft.type)}</span>
            {duplicate && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-muted">Already logged — excluded</span>}
            {conflict && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-warning">Conflict</span>}
            {missingOrOverlap && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-warning">Needs correction</span>}
            {isLowConfidence(row) && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-warning">Check carefully</span>}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            {summaryParts.map((part, index) => (
              <span key={`${index}:${part}`} className="inline-flex items-center gap-2">
                {index > 0 && <span aria-hidden="true" className="text-border">·</span>}
                <span className={index === 0 ? "tabular-nums" : undefined}>{part}</span>
              </span>
            ))}
          </p>
          <details className="mt-1 text-xs text-muted">
            <summary className="min-h-8 cursor-pointer py-1.5 underline-offset-2 hover:underline">Source text</summary>
            <p className="break-words rounded-lg bg-surface-muted px-2.5 py-2 leading-relaxed">{row.sourceText || "No readable source text"}</p>
          </details>
        </div>
      </div>

      <details
        className="group mt-3"
        open={editingOpen}
        onToggle={event => setEditingOpen(event.currentTarget.open)}
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted/60 px-3 text-xs font-semibold text-warm-brown focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/30 [&::-webkit-details-marker]:hidden">
          <span>Edit entry</span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className={`mt-3 grid gap-3 ${included ? "" : "opacity-65"}`}>
          <label className="text-xs font-medium text-warm-brown">Activity
            <select value={draft.type} disabled={disabled || !included} onChange={event => onChange({ type: event.target.value as ReviewDraft["type"] })} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm">
              <option value="bottlefeed">Feed</option>
              <option value="sleep">Nap</option>
              <option value="diaper">Diaper</option>
              <option value="note">Solids / care note</option>
            </select>
          </label>

          <label className="text-xs font-medium text-warm-brown">{draft.type === "sleep" ? "Start time" : "Time"} (Singapore)
            <input type="datetime-local" value={draft.startedAt} disabled={disabled || !included} onChange={event => onChange({ startedAt: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm tabular-nums" />
          </label>

          {draft.type === "sleep" && (
            <label className="text-xs font-medium text-warm-brown">End time (Singapore)
              <input type="datetime-local" value={draft.endedAt} disabled={disabled || !included} onChange={event => onChange({ endedAt: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm tabular-nums" />
            </label>
          )}

          {draft.type === "bottlefeed" && (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-2">
              <label className="text-xs font-medium text-warm-brown">Consumed
                <span className="mt-1 flex min-h-11 items-center rounded-lg border border-border bg-surface focus-within:ring-2 focus-within:ring-accent-strong/45">
                  <input inputMode="decimal" type="number" min="0.1" step="0.1" value={draft.amount} disabled={disabled || !included} onChange={event => onChange({ amount: event.target.value })} className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" />
                  <span className="pr-3 text-xs text-muted">ml</span>
                </span>
              </label>
              <label className="text-xs font-medium text-warm-brown">Milk type
                <select value={draft.milkType} disabled={disabled || !included} onChange={event => onChange({ milkType: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm">
                  <option value="">Choose type</option>
                  <option value="breastmilk">Breastmilk</option>
                  <option value="formula">Formula</option>
                </select>
              </label>
            </div>
          )}

          {draft.type === "diaper" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-medium text-warm-brown">Pee units
                <input inputMode="numeric" type="number" min="0" max="5" step="1" value={draft.peeUnits} disabled={disabled || !included} onChange={event => onChange({ peeUnits: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm" />
                <span className="mt-1 block font-normal text-muted">Wet defaults to 3 units</span>
              </label>
              <label className="text-xs font-medium text-warm-brown">Poop
                <select value={draft.poop} disabled={disabled || !included} onChange={event => onChange({ poop: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm">
                  <option value="no">Not shown</option>
                  <option value="yes">Shown (size not given)</option>
                  <option value="M">Medium</option>
                  <option value="L">Large</option>
                </select>
              </label>
            </div>
          )}

          <label className="text-xs font-medium text-warm-brown">{draft.type === "note" ? "Solids / care note" : "Note (optional)"}
            <textarea rows={2} maxLength={500} value={draft.note} disabled={disabled || !included} onChange={event => onChange({ note: event.target.value })} className="mt-1 w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
          </label>

          {row.origin === "uncertain" && included && (
            <label className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs font-medium text-warning">Who entered this source row?
              <select value={draft.resolvedOrigin} disabled={disabled} onChange={event => onChange({ resolvedOrigin: event.target.value as ReviewDraft["resolvedOrigin"] })} className="mt-2 min-h-11 w-full rounded-lg border border-amber-300 bg-surface px-3 text-sm text-warm-brown">
                <option value="">Choose one</option>
                <option value="caretaker">Infant care</option>
                <option value="household">Household member — exclude</option>
              </select>
            </label>
          )}

          {isLowConfidence(row) && included && (
            <label className="flex min-h-11 items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs leading-relaxed text-warning">
              <input type="checkbox" checked={draft.confirmLowConfidence} disabled={disabled} onChange={event => onChange({ confirmLowConfidence: event.target.checked })} className="mt-0.5 h-4 w-4 shrink-0 accent-terracotta-dark" />
              I checked this row against the screenshot.
            </label>
          )}
        </div>
      </details>

      {included && (row.issues.length > 0 || localIssues.length > 0) && (
        <div className="mt-3 space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-warning" role="status">
          {row.issues.map((issue, index) => <p key={`${issue.code}:${index}`}>{issue.message}</p>)}
          {localIssues.map((issue, index) => <p key={`local:${index}`}>{issue}</p>)}
        </div>
      )}
    </article>
  );
}

export default function CaretakerImportModal({
  babyId,
  babyName,
  onClose,
  onImported,
}: {
  babyId: string;
  babyName: string;
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scanAbortRef = useRef<AbortController | null>(null);
  const stageAttemptRef = useRef<StageAttempt | null>(null);
  const commitAttemptRef = useRef<CommitAttempt | null>(null);
  const [view, setView] = useState<View>("select");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => singaporeDate());
  const [progress, setProgress] = useState<CaretakerOcrProgress>({ status: "loading", progress: 0 });
  const [snapshot, setSnapshot] = useState<CaretakerImportSnapshot | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [reviewDirty, setReviewDirty] = useState(false);
  const [hasSavedReview, setHasSavedReview] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState<"save" | "commit" | "refresh" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<CaretakerCommitResponse | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      scanAbortRef.current?.abort();
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const rows = snapshot?.rows ?? [];
  const householdRows = rows.filter(row => row.origin === "household" || row.status === "blue_excluded");
  const visibleRows = rows.filter(row => !householdRows.includes(row));
  const groupedRows = useMemo(() => {
    const order: ReviewDraft["type"][] = ["bottlefeed", "sleep", "diaper", "note"];
    return order.map(type => ({ type, rows: visibleRows.filter(row => (drafts[row.id]?.type ?? row.draft.type) === type) })).filter(group => group.rows.length > 0);
  }, [drafts, visibleRows]);
  const selectedRows = visibleRows.filter(row => drafts[row.id]?.action === "include");
  const selectedBreastmilk = selectedRows.reduce((total, row) => {
    const draft = drafts[row.id];
    return total + (draft?.type === "bottlefeed" && draft.milkType === "breastmilk" ? Number(draft.amount) || 0 : 0);
  }, 0);
  const localBlockers = selectedRows.flatMap(row => localBlockingIssues(row, drafts[row.id], snapshot?.batch.selectedDate ?? selectedDate));
  const serverBlockers = selectedRows.flatMap(row => row.issues.filter(issue => issue.blocking));
  const canCommit = Boolean(
    snapshot
    && selectedRows.length > 0
    && hasSavedReview
    && !reviewDirty
    && !stale
    && localBlockers.length === 0
    && serverBlockers.length === 0
    && reviewConfirmed
    && !busy,
  );

  const resetImport = (keepDate = true) => {
    scanAbortRef.current?.abort();
    scanAbortRef.current = null;
    stageAttemptRef.current = null;
    commitAttemptRef.current = null;
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!keepDate) setSelectedDate(singaporeDate());
    setSnapshot(null);
    setDrafts({});
    setReviewDirty(false);
    setHasSavedReview(false);
    setReviewConfirmed(false);
    setStale(false);
    setBusy(null);
    setSuccess(null);
    setRefreshWarning(null);
    setView("select");
  };

  const expireImport = () => {
    resetImport(true);
    setError("This screenshot review expired and the same image cannot be staged again. Add those activities manually, or choose a different screenshot.");
  };

  const requestClose = () => {
    if (busy === "save" || busy === "commit" || busy === "refresh") return;
    const dirty = view !== "success" && Boolean(file || snapshot || view === "scanning");
    if (dirty && !window.confirm("Discard this screenshot import?")) return;
    if (view === "scanning") scanAbortRef.current?.abort();
    onClose();
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    setError(null);
    stageAttemptRef.current = null;
    if (!next) return setFile(null);
    if (!CARETAKER_IMPORT_IMAGE_TYPES.includes(next.type as (typeof CARETAKER_IMPORT_IMAGE_TYPES)[number])) {
      event.target.value = "";
      setFile(null);
      setError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (next.size > CARETAKER_IMPORT_MAX_IMAGE_BYTES) {
      event.target.value = "";
      setFile(null);
      setError("This image is larger than 3 MiB. Choose a smaller screenshot.");
      return;
    }
    setFile(next);
  };

  const finishCommittedSnapshot = async (committed: CaretakerImportSnapshot) => {
    const committedCount = committed.rows.filter(row => row.status === "committed").length;
    setSuccess({
      batchId: committed.batch.id,
      committedActivityIds: [],
      committedCount,
      idempotent: true,
    });
    setView("success");
    try { await onImported(); } catch {
      setRefreshWarning("The activities were already imported, but the dashboard could not refresh. Close this window and refresh when you are online.");
    }
  };

  const stageScreenshot = async () => {
    if (!file || !selectedDate || view === "scanning") return;
    const signature = `${file.name}:${file.size}:${file.lastModified}:${selectedDate}`;
    let attempt = stageAttemptRef.current;
    if (!attempt || attempt.signature !== signature) {
      attempt = { signature, requestId: crypto.randomUUID(), file, date: selectedDate, lines: null };
      stageAttemptRef.current = attempt;
    }

    const controller = new AbortController();
    scanAbortRef.current = controller;
    setView("scanning");
    setError(null);
    setProgress({ status: "loading", progress: 0 });
    try {
      if (!attempt.lines) {
        attempt.lines = await recognizeCaretakerScreenshot(attempt.file, {
          signal: controller.signal,
          onProgress: update => setProgress(update),
        });
      }
      setProgress({ status: "classifying", progress: 1 });
      const form = new FormData();
      form.set("babyId", babyId);
      form.set("date", attempt.date);
      form.set("requestId", attempt.requestId);
      form.set("lines", JSON.stringify(attempt.lines));
      form.set("image", attempt.file);
      const staged = await requestJson<CaretakerStageResponse>("/api/caretaker-import/stage", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (staged.batch.status === "committed") {
        await finishCommittedSnapshot(staged);
        return;
      }
      if (staged.batch.status === "expired" || !staged.batch.sourceAvailable) {
        expireImport();
        return;
      }
      setSnapshot(staged);
      setDrafts(draftsFromSnapshot(staged));
      setReviewDirty(false);
      setHasSavedReview(false);
      setReviewConfirmed(false);
      setStale(false);
      setView("review");
    } catch (caught) {
      if ((caught as Error).name === "AbortError") {
        setError(null);
      } else {
        setError(caught instanceof Error ? caught.message : "Could not read this screenshot. Try again.");
      }
      setView("select");
    } finally {
      if (scanAbortRef.current === controller) scanAbortRef.current = null;
    }
  };

  const updateDraft = (rowId: string, change: Partial<ReviewDraft>) => {
    setDrafts(current => {
      const next = { ...current[rowId], ...change };
      if (change.resolvedOrigin === "household") next.action = "exclude";
      return { ...current, [rowId]: next };
    });
    setReviewDirty(true);
    setReviewConfirmed(false);
    setHasSavedReview(false);
    setStale(false);
    setError(null);
    commitAttemptRef.current = null;
  };

  const importNonDuplicates = () => {
    setDrafts(current => Object.fromEntries(rows.map(row => {
      const draft = current[row.id];
      const isHousehold = row.origin === "household" || row.status === "blue_excluded" || draft.resolvedOrigin === "household";
      const isExactDuplicate = row.status === "duplicate"
        || row.issues.some(issue => issue.code === "EXACT_DUPLICATE");
      return [row.id, isHousehold || isExactDuplicate ? { ...draft, action: "exclude" } : draft];
    })));
    setReviewDirty(true);
    setHasSavedReview(false);
    setReviewConfirmed(false);
    setError(null);
    commitAttemptRef.current = null;
  };

  const saveReview = async () => {
    if (!snapshot || busy) return;
    const includedWithLocalErrors = rows.filter(row => localBlockingIssues(row, drafts[row.id], snapshot.batch.selectedDate).length > 0);
    if (includedWithLocalErrors.length > 0) {
      setError("Fix or exclude every highlighted row before saving the review.");
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const updated = await requestJson<CaretakerImportSnapshot>("/api/caretaker-import/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: snapshot.batch.id,
          expectedRevision: snapshot.batch.revision,
          rows: rows.map(row => reviewInput(row, drafts[row.id])),
        }),
      });
      if (updated.batch.status === "expired" || !updated.batch.sourceAvailable) return expireImport();
      setSnapshot(updated);
      setDrafts(draftsFromSnapshot(updated));
      setReviewDirty(false);
      setHasSavedReview(true);
      setReviewConfirmed(false);
      setStale(false);
      commitAttemptRef.current = null;
    } catch (caught) {
      if (caught instanceof CaretakerRequestError && caught.code.includes("EXPIRED")) return expireImport();
      if (caught instanceof CaretakerRequestError && ["REVISION_CONFLICT", "ALREADY_COMMITTED"].includes(caught.code)) {
        setStale(true);
        setError("This review changed elsewhere. Your edits are still here. Load the latest copy, then review it again.");
      } else {
        setError(caught instanceof Error ? caught.message : "Could not save the review. Try again.");
      }
    } finally {
      setBusy(null);
    }
  };

  const loadLatest = async () => {
    if (!snapshot || busy) return;
    setBusy("refresh");
    setError(null);
    try {
      const latest = await requestJson<CaretakerImportSnapshot>(`/api/caretaker-import?batchId=${encodeURIComponent(snapshot.batch.id)}`);
      if (latest.batch.status === "committed") {
        await finishCommittedSnapshot(latest);
        return;
      }
      if (latest.batch.status === "expired" || !latest.batch.sourceAvailable) return expireImport();
      setSnapshot(latest);
      setDrafts(draftsFromSnapshot(latest));
      setReviewDirty(false);
      setHasSavedReview(false);
      setReviewConfirmed(false);
      setStale(false);
      commitAttemptRef.current = null;
    } catch (caught) {
      if (caught instanceof CaretakerRequestError && caught.code.includes("EXPIRED")) return expireImport();
      setError(caught instanceof Error ? caught.message : "Could not load the latest review. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!snapshot || !canCommit || busy) return;
    const signature = `${snapshot.batch.id}:${snapshot.batch.revision}`;
    if (!commitAttemptRef.current || commitAttemptRef.current.signature !== signature) {
      commitAttemptRef.current = { signature, requestId: crypto.randomUUID() };
    }
    const attempt = commitAttemptRef.current;
    setBusy("commit");
    setError(null);
    try {
      const committed = await requestJson<CaretakerCommitResponse>("/api/caretaker-import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: snapshot.batch.id,
          expectedRevision: snapshot.batch.revision,
          requestId: attempt.requestId,
        }),
      });
      setSuccess(committed);
      setView("success");
      try {
        await onImported();
      } catch {
        setRefreshWarning("The activities were imported, but the dashboard could not refresh. Close this window and refresh when you are online.");
      }
    } catch (caught) {
      if (caught instanceof CaretakerRequestError && caught.code.includes("EXPIRED")) return expireImport();
      if (caught instanceof CaretakerRequestError && (caught.status === 409 || (caught.issues?.length ?? 0) > 0)) {
        setReviewConfirmed(false);
        setStale(true);
        commitAttemptRef.current = null;
        setError(`Nothing was imported. ${caught.message} Load the latest copy and review the highlighted rows.`);
      } else if (caught instanceof CaretakerRequestError) {
        setReviewConfirmed(false);
        setHasSavedReview(false);
        commitAttemptRef.current = null;
        setError(`Nothing was imported. ${caught.message} Correct or exclude the affected entries, then save the review again.`);
      } else {
        setError("We could not confirm whether the import finished. Retry below; the same import will be safely reused.");
      }
    } finally {
      setBusy(null);
    }
  };

  const progressLabel = progress.status === "loading"
    ? "Preparing the reader…"
    : progress.status === "recognizing"
      ? "Reading the screenshot…"
      : "Checking entries and colours…";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="caretaker-import-title"
      onCancel={event => { event.preventDefault(); requestClose(); }}
      onClick={event => { if (event.target === dialogRef.current) requestClose(); }}
      className="baby-care-dialog m-auto w-[calc(100%_-_1rem)] max-w-3xl overflow-y-auto rounded-2xl border border-border bg-surface p-0 text-warm-brown shadow-xl sm:w-[calc(100%_-_2rem)]"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-strong">{babyName}</p>
          <h2 id="caretaker-import-title" className="truncate font-display text-lg font-semibold">Import caretaker screenshot</h2>
        </div>
        <button type="button" aria-label="Close caretaker screenshot import" disabled={Boolean(busy)} onClick={requestClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-muted disabled:opacity-50"><X aria-hidden="true" className="h-5 w-5" /></button>
      </div>

      {view === "select" && (
        <div className="space-y-4 p-4 sm:p-5">
          <div className="rounded-xl border border-terracotta/25 bg-terracotta/10 p-3 text-sm leading-relaxed text-warm-brown">
            <p className="flex items-start gap-2"><ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent-strong" /><span>The screenshot is read on this device. Screenshots and extracted drafts are kept privately for up to 7 days so your household can finish the review.</span></p>
            <p className="mt-2 flex items-start gap-2"><ScanLine aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent-strong" /><span>No paid service or external AI is used. Every entry must be reviewed. Blue household entries are always skipped, and imported breastmilk feeds reduce the breastmilk bank.</span></p>
          </div>

          <label className="block text-sm font-semibold">Activity date (Singapore)
            <span className="mt-1 block text-xs font-normal text-muted">Use the date covered by this screenshot.</span>
            <span className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-surface px-3 focus-within:ring-2 focus-within:ring-accent-strong/45">
              <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-accent-strong" />
              <input autoFocus type="date" required max={singaporeDate()} value={selectedDate} onChange={event => { setSelectedDate(event.target.value); stageAttemptRef.current = null; setError(null); }} className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" />
            </span>
          </label>

          <div>
            <label htmlFor="caretaker-screenshot" className="block text-sm font-semibold">Screenshot</label>
            <p className="mt-1 text-xs text-muted">PNG, JPEG, or WebP · maximum 3 MiB · one image</p>
            <input ref={fileInputRef} id="caretaker-screenshot" type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseFile} className="mt-2 block w-full cursor-pointer rounded-xl border border-dashed border-terracotta/45 bg-terracotta/5 p-3 text-sm file:mr-3 file:min-h-9 file:rounded-lg file:border-0 file:bg-terracotta-dark file:px-3 file:text-sm file:font-semibold file:text-white" />
          </div>

          {previewUrl && (
            <div className="overflow-hidden rounded-xl border border-border bg-surface-muted">
              {/* Blob URLs are local previews and cannot use Next's image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Selected caretaker screenshot" className="max-h-72 w-full object-contain" />
              <p className="truncate border-t border-border px-3 py-2 text-xs text-muted">{file?.name}</p>
            </div>
          )}

          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>}
          <button type="button" onClick={() => { void stageScreenshot(); }} disabled={!file || !selectedDate} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-terracotta-dark px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-warm-brown disabled:opacity-45">
            <ImageUp aria-hidden="true" className="h-5 w-5" />{stageAttemptRef.current?.lines ? "Retry preparing review" : "Read screenshot"}
          </button>
        </div>
      )}

      {view === "scanning" && (
        <div className="flex min-h-[420px] flex-col items-center justify-center p-6 text-center">
          <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-terracotta/25 bg-terracotta/10">
            <ScanLine aria-hidden="true" className="h-9 w-9 text-accent-strong" />
            <LoaderCircle aria-hidden="true" className="absolute -inset-2 h-24 w-24 animate-spin text-terracotta/35 motion-reduce:animate-none" />
          </div>
          <h3 className="mt-6 font-display text-xl font-semibold">{progressLabel}</h3>
          <p className="mt-2 max-w-sm text-sm text-muted">Keep this window open. Reading happens on this device, then the screenshot is stored privately for your household review.</p>
          <div className="mt-5 h-2 w-full max-w-sm overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.progress * 100)} aria-label={progressLabel}>
            <div className="h-full rounded-full bg-terracotta-dark transition-[width] motion-reduce:transition-none" style={{ width: `${Math.max(4, Math.round(progress.progress * 100))}%` }} />
          </div>
          <p className="mt-2 text-xs tabular-nums text-muted">{Math.round(progress.progress * 100)}%</p>
          <button type="button" onClick={() => scanAbortRef.current?.abort()} className="mt-6 min-h-11 rounded-xl border border-border px-5 text-sm font-semibold">Cancel</button>
        </div>
      )}

      {view === "review" && snapshot && (
        <div className="space-y-5 p-4 sm:p-5">
          <section className="grid gap-3 rounded-xl border border-border bg-surface-muted/45 p-3 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              {previewUrl ? <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="Source caretaker screenshot" className="max-h-64 w-full object-contain" />
              </> : <div className="flex min-h-40 items-center justify-center text-xs text-muted">Source image unavailable</div>}
            </div>
            <div className="flex flex-col justify-center">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent-strong">Review before importing</p>
              <h3 className="mt-1 font-display text-lg font-semibold">{snapshot.batch.selectedDate} · Singapore time</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">Check every included entry against the image. Exclude anything incomplete or incorrect. Blue entries remain skipped.</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-surface px-2.5 py-1 font-semibold">{selectedRows.length} selected</span>
                {selectedBreastmilk > 0 && <span className="rounded-full bg-surface px-2.5 py-1 font-semibold">{selectedBreastmilk} ml from bank</span>}
                <span className="rounded-full bg-surface px-2.5 py-1 font-semibold">Kept up to 7 days</span>
              </div>
            </div>
          </section>

          {householdRows.length > 0 && (
            <details className="rounded-xl border border-sky-200 bg-sky-50/70">
              <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-3 py-2 text-sm font-semibold text-sky-900">
                <ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0" />
                {householdRows.length} household {householdRows.length === 1 ? "entry" : "entries"} (blue) — excluded
              </summary>
              <div className="border-t border-sky-200 px-3 py-2 text-xs text-sky-900">
                {householdRows.map(row => <p key={row.id} className="border-b border-sky-200/70 py-2 last:border-0">{row.sourceText || rowLabel(row.draft.type)}</p>)}
              </div>
            </details>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">Your other include/exclude choices stay unchanged. Incomplete and uncertain rows still need review.</p>
            <button type="button" disabled={Boolean(busy)} onClick={importNonDuplicates} className="min-h-9 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-accent-strong disabled:opacity-50">Import non-duplicates only</button>
          </div>

          {visibleRows.length === 0 ? (
            <p className="rounded-xl border border-border bg-surface-muted p-4 text-sm text-muted">No infant-care entries are available to import from this screenshot.</p>
          ) : groupedRows.map(group => (
            <section key={group.type} className="space-y-2.5">
              <SectionHeading icon={group.type === "bottlefeed" ? <Milk className="h-4 w-4" /> : group.type === "sleep" ? <Moon className="h-4 w-4" /> : group.type === "diaper" ? <Baby className="h-4 w-4" /> : <UtensilsCrossed className="h-4 w-4" />}>
                {group.type === "bottlefeed" ? "Feeds" : group.type === "sleep" ? "Naps" : group.type === "diaper" ? "Diapers" : "Solids and notes"}
              </SectionHeading>
              {group.rows.map(row => <ReviewRowCard key={row.id} row={row} draft={drafts[row.id]} selectedDate={snapshot.batch.selectedDate} disabled={Boolean(busy)} onChange={change => updateDraft(row.id, change)} />)}
            </section>
          ))}

          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm leading-relaxed text-danger">{error}</p>}
          {stale && (
            <button type="button" disabled={Boolean(busy)} onClick={() => { void loadLatest(); }} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-warning/40 bg-amber-50 px-4 text-sm font-semibold text-warning disabled:opacity-50">
              <RotateCcw aria-hidden="true" className={`h-4 w-4 ${busy === "refresh" ? "animate-spin motion-reduce:animate-none" : ""}`} />{busy === "refresh" ? "Loading latest…" : "Load latest copy and review again"}
            </button>
          )}

          <div className="sticky bottom-0 -mx-4 space-y-3 border-t border-border bg-surface/95 px-4 pb-4 pt-3 backdrop-blur sm:-mx-5 sm:px-5 sm:pb-5">
            <button type="button" disabled={Boolean(busy) || stale} onClick={() => { void saveReview(); }} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-terracotta/40 bg-terracotta/10 px-4 text-sm font-semibold text-accent-strong disabled:opacity-45">
              {busy === "save" ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Check aria-hidden="true" className="h-4 w-4" />}
              {busy === "save" ? "Checking review…" : hasSavedReview && !reviewDirty ? "Review saved" : "Save reviewed rows"}
            </button>
            <label className={`flex items-start gap-3 rounded-xl border p-3 text-sm leading-relaxed ${hasSavedReview && !reviewDirty && !stale ? "border-border" : "border-border bg-surface-muted text-muted"}`}>
              <input type="checkbox" checked={reviewConfirmed} disabled={!hasSavedReview || reviewDirty || stale || Boolean(busy) || selectedRows.length === 0 || localBlockers.length > 0 || serverBlockers.length > 0} onChange={event => setReviewConfirmed(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-terracotta-dark" />
              I reviewed every included row against the screenshot. Amounts are consumed amounts, and included breastmilk feeds can be deducted from the breastmilk bank.
            </label>
            {(localBlockers.length > 0 || serverBlockers.length > 0) && <p className="flex items-start gap-2 text-xs leading-relaxed text-warning"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />Fix or exclude every highlighted entry, then save the review again.</p>}
            <button type="button" disabled={!canCommit} onClick={() => { void commit(); }} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-terracotta-dark px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-warm-brown disabled:opacity-45">
              {busy === "commit" ? <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin motion-reduce:animate-none" /> : <ImageUp aria-hidden="true" className="h-5 w-5" />}
              {busy === "commit" ? "Importing…" : `Import ${selectedRows.length} ${selectedRows.length === 1 ? "entry" : "entries"}`}
            </button>
          </div>
        </div>
      )}

      {view === "success" && success && (
        <div className="flex min-h-[440px] flex-col items-center justify-center p-6 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-success"><CheckCircle2 aria-hidden="true" className="h-11 w-11" /></span>
          <h3 className="mt-5 font-display text-2xl font-semibold">Import complete</h3>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
            {success.idempotent
              ? `${success.committedCount} ${success.committedCount === 1 ? "activity from this screenshot is" : "activities from this screenshot are"} already in ${babyName}'s diary.`
              : `${success.committedCount} ${success.committedCount === 1 ? "activity was" : "activities were"} added to ${babyName}'s diary.`}
          </p>
          {refreshWarning && <p role="alert" className="mt-4 max-w-sm rounded-lg bg-amber-50 px-3 py-2 text-sm text-warning">{refreshWarning}</p>}
          <div className="mt-7 grid w-full max-w-sm gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => { setError(null); resetImport(true); }} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-semibold"><ImageUp aria-hidden="true" className="h-4 w-4" />Import another</button>
            <button type="button" onClick={onClose} autoFocus className="min-h-11 rounded-xl bg-terracotta-dark px-4 text-sm font-semibold text-white">Done</button>
          </div>
        </div>
      )}
    </dialog>
  );
}

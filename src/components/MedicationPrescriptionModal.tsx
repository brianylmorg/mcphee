"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Pill, Plus, X } from "lucide-react";
import {
  identifyMedicationPrescriptionDraft,
  type IdentifiedMedicationPrescriptionDraftInput,
  type MedicationPrescriptionDraftInput,
} from "@/lib/medication-entry";
import { mutateSickMode } from "@/lib/sick-mode-client";

type MedicationDraft = IdentifiedMedicationPrescriptionDraftInput & { key: string };

export function prepareMedicationPrescriptionDraft(
  draft: MedicationPrescriptionDraftInput,
): MedicationDraft {
  const identified = identifyMedicationPrescriptionDraft(draft);
  return { ...identified, key: identified.requestId };
}

function emptyMedication(): MedicationDraft {
  return prepareMedicationPrescriptionDraft({
    name: "",
    doseText: "",
    asNeeded: true,
    minIntervalHours: "",
    maxIntervalHours: "",
  });
}

function withKey(draft: MedicationPrescriptionDraftInput): MedicationDraft {
  return prepareMedicationPrescriptionDraft(draft);
}

function numericOrUndefined(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function buildMedicationPrescriptionAddPayload({
  babyId,
  episodeId,
  draft,
}: {
  babyId: string;
  episodeId: string;
  draft: IdentifiedMedicationPrescriptionDraftInput;
}): Record<string, unknown> {
  return {
    action: "addMedication",
    babyId,
    episodeId,
    requestId: draft.requestId,
    name: draft.name.trim(),
    doseText: draft.doseText.trim(),
    asNeeded: draft.asNeeded,
    minIntervalHours: numericOrUndefined(draft.minIntervalHours),
    maxIntervalHours: numericOrUndefined(draft.maxIntervalHours),
  };
}

export function hasUnsavedMedicationPrescription(drafts: MedicationPrescriptionDraftInput[]): boolean {
  return drafts.some((draft) => Boolean(
    draft.name.trim()
    || draft.doseText.trim()
    || draft.minIntervalHours.trim()
    || draft.maxIntervalHours.trim()
    || !draft.asNeeded
  ));
}

function MedicationFields({
  draft,
  onChange,
  onRemove,
  suggestions,
  removable,
  autoFocus,
  disabled,
}: {
  draft: MedicationDraft;
  onChange: (draft: MedicationDraft) => void;
  onRemove?: () => void;
  suggestions: string[];
  removable?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-start gap-2">
        <label className="min-w-0 flex-1 text-xs font-medium text-warm-brown-light">
          Medication name
          <input
            autoFocus={autoFocus}
            disabled={disabled}
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            list={`medication-prescription-suggestions-${draft.key}`}
            placeholder="e.g. Paracetamol"
            className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-warm-brown outline-none focus:border-accent-strong disabled:opacity-60"
          />
        </label>
        {removable && onRemove && (
          <button type="button" disabled={disabled} onClick={onRemove} aria-label="Remove medication" className="mt-5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-red-50 hover:text-danger disabled:opacity-50">
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </div>
      <label className="mt-3 block text-xs font-medium text-warm-brown-light">
        Prescribed dose
        <input
          disabled={disabled}
          value={draft.doseText}
          onChange={(event) => onChange({ ...draft, doseText: event.target.value })}
          placeholder="e.g. 3.5 ml"
          className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base text-warm-brown outline-none focus:border-accent-strong disabled:opacity-60"
        />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-xs font-medium text-warm-brown-light">
          Earliest interval (hours)
          <input disabled={disabled} type="number" min="0" step="0.5" inputMode="decimal" value={draft.minIntervalHours} onChange={(event) => onChange({ ...draft, minIntervalHours: event.target.value })} placeholder="4" className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base tabular-nums text-warm-brown outline-none focus:border-accent-strong disabled:opacity-60" />
        </label>
        <label className="text-xs font-medium text-warm-brown-light">
          Latest interval (hours)
          <input disabled={disabled} type="number" min="0" step="0.5" inputMode="decimal" value={draft.maxIntervalHours} onChange={(event) => onChange({ ...draft, maxIntervalHours: event.target.value })} placeholder="6" className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base tabular-nums text-warm-brown outline-none focus:border-accent-strong disabled:opacity-60" />
        </label>
      </div>
      <label className="mt-3 flex min-h-9 items-center gap-2 text-sm text-warm-brown">
        <input disabled={disabled} type="checkbox" checked={draft.asNeeded} onChange={(event) => onChange({ ...draft, asNeeded: event.target.checked })} className="h-5 w-5 rounded border-border text-terracotta-dark disabled:opacity-60" />
        As needed
      </label>
      <datalist id={`medication-prescription-suggestions-${draft.key}`}>
        {suggestions.map((name) => <option key={name} value={name} />)}
      </datalist>
    </div>
  );
}

export default function MedicationPrescriptionModal({
  babyId,
  episodeId,
  suggestions,
  initialDrafts,
  isStale,
  onClose,
  onRefresh,
}: {
  babyId: string;
  episodeId: string;
  suggestions: string[];
  initialDrafts?: MedicationPrescriptionDraftInput[];
  isStale: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [drafts, setDrafts] = useState<MedicationDraft[]>(() => initialDrafts?.length ? initialDrafts.map(withKey) : [emptyMedication()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = drafts.length > 0 && drafts.every((draft) => draft.name.trim() && draft.doseText.trim());
  const dirty = hasUnsavedMedicationPrescription(drafts);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  const requestClose = () => {
    if (busy) return;
    if (dirty && !confirm("Discard this unsaved medication prescription?")) return;
    onClose();
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || isStale || !valid) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const pending = [...drafts];
    try {
      for (const draft of drafts) {
        await mutateSickMode(buildMedicationPrescriptionAddPayload({ babyId, episodeId, draft }));
        pending.shift();
      }
      onClose();
      await onRefresh();
    } catch (caught) {
      setDrafts(pending.length > 0 ? pending : [emptyMedication()]);
      setError(caught instanceof Error ? caught.message : "Could not save the remaining medication prescriptions. Try again.");
      await onRefresh();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      data-medication-entry-form="add"
      aria-labelledby="medication-prescription-title"
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
      onClick={(event) => { if (event.target === dialogRef.current) requestClose(); }}
      className="baby-care-dialog m-auto w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-0 text-warm-brown shadow-xl"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2"><Pill aria-hidden="true" className="h-5 w-5 text-accent-strong" /><h2 id="medication-prescription-title" className="text-lg font-semibold">Add medication prescription</h2></div>
        <button type="button" aria-label="Close medication prescription" disabled={busy} onClick={requestClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-muted disabled:opacity-50"><X aria-hidden="true" className="h-5 w-5" /></button>
      </div>
      <form onSubmit={save} className="space-y-3 p-4">
        {isStale && <p role="status" className="text-xs text-warning">Details are out of date. Saving is paused until reconnecting; your entries are preserved.</p>}
        {drafts.map((draft, index) => (
          <MedicationFields
            key={draft.key}
            draft={draft}
            suggestions={suggestions}
            removable={drafts.length > 1}
            autoFocus={index === 0}
            disabled={busy || isStale}
            onChange={(next) => setDrafts((items) => items.map((item, itemIndex) => itemIndex === index ? next : item))}
            onRemove={() => setDrafts((items) => items.filter((_, itemIndex) => itemIndex !== index))}
          />
        ))}
        <button type="button" disabled={busy || isStale} onClick={() => setDrafts((items) => [...items, emptyMedication()])} className="inline-flex min-h-9 items-center gap-1 px-2 text-xs font-semibold text-accent-strong disabled:opacity-50"><Plus aria-hidden="true" className="h-4 w-4" />Add another</button>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={busy || isStale || !valid} className="min-h-11 w-full rounded-lg bg-terracotta-dark px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : `Save medication${drafts.length === 1 ? "" : "s"}`}</button>
      </form>
    </dialog>
  );
}

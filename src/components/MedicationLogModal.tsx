"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Pill, X } from "lucide-react";
import type { SickMedication } from "@/lib/sick-mode";
import { formatElapsedSince } from "@/lib/elapsed-time";
import { formatTime } from "@/lib/utils";
import { mutateSickMode, parseSgtDateTime, sgtDateTimeInput } from "@/lib/sick-mode-client";

export function initialDoseTime(episodeStartedAt: number, now = Date.now()): string {
  // Preserve seconds so a dose can be recorded in the episode's first minute.
  return sgtDateTimeInput(Math.max(now, Math.ceil(episodeStartedAt / 1_000) * 1_000), true);
}

export function buildLogDosePayload({ babyId, episodeId, medicationId, givenAt, doseText, requestId, expectedLatestDoseId }: {
  babyId: string; episodeId: string; medicationId: string; givenAt: number; doseText: string;
  requestId: string; expectedLatestDoseId: string | null;
}): Record<string, unknown> {
  return { action: "logDose", babyId, episodeId, medicationId, givenAt, doseText: doseText.trim(), requestId, expectedLatestDoseId };
}

export function isMedicationLogDirty({
  initialMedicationId,
  medicationId,
  initialGivenAt,
  givenAt,
  doseText,
}: {
  initialMedicationId?: string;
  medicationId?: string;
  initialGivenAt: string;
  givenAt: string;
  doseText: string;
}): boolean {
  return Boolean(doseText.trim() || medicationId !== initialMedicationId || givenAt !== initialGivenAt);
}

export default function MedicationLogModal({ babyId, episodeId, episodeStartedAt, medications, initialMedicationId, isStale, onClose, onRefresh }: {
  babyId: string; episodeId: string; episodeStartedAt: number; medications: SickMedication[];
  initialMedicationId?: string; isStale: boolean; onClose: () => void; onRefresh: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const attempt = useRef<{ signature: string; requestId: string; expectedLatestDoseId: string | null } | null>(null);
  const initialGivenAt = useRef(initialDoseTime(episodeStartedAt));
  const [selected, setSelected] = useState(() => medications.find(medication => medication.id === initialMedicationId) ?? null);
  const [doseText, setDoseText] = useState("");
  const [givenAt, setGivenAt] = useState(initialGivenAt.current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReview, setNeedsReview] = useState(false);
  const timestamp = parseSgtDateTime(givenAt);
  const invalidTime = timestamp == null || timestamp < episodeStartedAt || timestamp > Date.now();
  const currentMedication = medications.find(medication => medication.id === selected?.id);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  const requestClose = () => {
    if (busy) return;
    const dirty = isMedicationLogDirty({
      initialMedicationId,
      medicationId: selected?.id,
      initialGivenAt: initialGivenAt.current,
      givenAt,
      doseText,
    });
    if (dirty && !confirm("Discard this unsaved medication dose?")) return;
    onClose();
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || isStale || needsReview || !selected || !currentMedication || invalidTime || timestamp == null || !doseText.trim()) return;
    const signature = JSON.stringify([selected.id, timestamp, doseText.trim()]);
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, requestId: crypto.randomUUID(), expectedLatestDoseId: selected.latestDose?.id ?? null };
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await mutateSickMode(buildLogDosePayload({ babyId, episodeId, medicationId: selected.id, givenAt: timestamp, doseText, ...attempt.current }));
      // Close after the confirmed write; a failed refresh must not offer another dose.
      onClose();
      await onRefresh();
    } catch (caught) {
      const status = (caught as { status?: number }).status;
      if (status === 409) {
        setNeedsReview(true);
        setError("Medication history changed. Review the latest details before saving again.");
      } else {
        setError(caught instanceof Error ? caught.message : "Could not record this dose. Try again.");
      }
      await onRefresh();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} data-medication-entry-form="log" aria-labelledby="medication-log-title" onCancel={event => { event.preventDefault(); requestClose(); }} onClick={event => { if (event.target === dialogRef.current) requestClose(); }} className="baby-care-dialog m-auto w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-0 text-warm-brown shadow-xl">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2"><Pill aria-hidden="true" className="h-5 w-5 text-accent-strong" /><h2 id="medication-log-title" className="text-lg font-semibold">Log medication</h2></div>
        <button type="button" aria-label="Close medication log" disabled={busy} onClick={requestClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-muted disabled:opacity-50"><X aria-hidden="true" className="h-5 w-5" /></button>
      </div>
      <form onSubmit={save} className="space-y-4 p-4">
        {isStale && <p role="status" className="text-xs text-warning">Details are out of date. Logging is paused until reconnecting.</p>}
        {medications.length === 0 ? <p className="text-sm text-muted">Add a medication in Health check-in first, then record its doses here.</p> : <>
          <label className="block text-sm font-medium">Medication
            <select autoFocus required disabled={busy || isStale} value={selected?.id ?? ""} onChange={event => { setSelected(medications.find(medication => medication.id === event.target.value) ?? null); attempt.current = null; setNeedsReview(false); setError(null); }} className="mt-2 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm">
              <option value="">Choose medication</option>
              {medications.map(medication => <option key={medication.id} value={medication.id}>{medication.name}{medication.asNeeded ? " · As needed" : ""}</option>)}
            </select>
          </label>
          {selected && <div className="rounded-lg bg-surface-muted p-3 text-xs leading-relaxed"><p>Entered prescription: <span className="font-semibold">{selected.doseText}</span>{selected.asNeeded ? " · As needed" : ""}</p><p className="mt-1 text-muted">{selected.latestDose ? `Last given ${formatTime(selected.latestDose.givenAt)} · ${formatElapsedSince(selected.latestDose.givenAt)}` : "No doses logged"}</p></div>}
          <label className="block text-sm font-medium">Amount given
            <input required maxLength={120} value={doseText} disabled={busy || isStale} onChange={event => setDoseText(event.target.value)} placeholder="Amount and unit, e.g. 3.5 ml" className="mt-2 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm font-medium">Time given (Singapore)
            <input required type="datetime-local" step="1" value={givenAt} disabled={busy || isStale} onChange={event => setGivenAt(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
          </label>
          {invalidTime && <p role="alert" className="text-xs text-danger">Choose a time within this sick-mode episode, not in the future.</p>}
          <p className="text-xs leading-relaxed text-muted">Record the amount actually given. Follow the prescribed instructions; this form does not calculate or recommend a dose.</p>
        </>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {needsReview && <button type="button" disabled={isStale || busy || !currentMedication} onClick={() => { setSelected(currentMedication ?? null); attempt.current = null; setNeedsReview(false); setError(null); }} className="min-h-11 w-full rounded-lg border border-border px-3 text-sm font-semibold">Review latest history</button>}
        <button type="submit" disabled={busy || isStale || needsReview || !currentMedication || invalidTime || !doseText.trim()} className="min-h-11 w-full rounded-lg bg-terracotta-dark px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save dose"}</button>
      </form>
    </dialog>
  );
}

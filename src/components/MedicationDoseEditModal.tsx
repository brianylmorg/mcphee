"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Pill, X } from "lucide-react";
import type { MedicationDoseReference } from "@/lib/activity-timeline";
import { mutateSickMode, parseSgtDateTime, sgtDateTimeInput } from "@/lib/sick-mode-client";

/**
 * The diary row shape this editor needs. The dose reference is captured from
 * the timeline record (one read projection over the stored dose), so the
 * commit uses the exact stored revision rather than a fresh guess.
 */
export type MedicationDoseEditActivity = {
  id: string;
  type: string;
  started_at: number;
  medicationDose: MedicationDoseReference;
};

export default function MedicationDoseEditModal({ babyId, activity, onClose, onRefresh }: {
  babyId: string;
  activity: MedicationDoseEditActivity;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const dose = activity.medicationDose;
  // Capture the revision/time/text at mount so a later store refresh cannot
  // silently retarget this editor at a newer revision.
  const originalRevision = useRef(dose.revision);
  const originalGivenAt = useRef(sgtDateTimeInput(activity.started_at, true));
  const originalDoseText = useRef(dose.doseText);
  const [doseText, setDoseText] = useState(dose.doseText);
  const [givenAt, setGivenAt] = useState(originalGivenAt.current);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timestamp = parseSgtDateTime(givenAt);
  const invalidTime = timestamp == null
    || timestamp < dose.episodeStartedAt
    || (dose.episodeEndedAt != null && timestamp > dose.episodeEndedAt)
    || timestamp > Date.now();
  const dirty = givenAt !== originalGivenAt.current || doseText.trim() !== originalDoseText.current.trim();

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
    if (dirty && !confirm("Discard changes to this medication dose?")) return;
    onClose();
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || stale || invalidTime || timestamp == null || !doseText.trim()) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await mutateSickMode({
        action: "updateDose",
        babyId,
        episodeId: dose.episodeId,
        medicationId: dose.medicationId,
        doseId: dose.doseId,
        expectedRevision: originalRevision.current,
        givenAt: timestamp,
        doseText: doseText.trim(),
      });
      // Close after the confirmed write; a failed refresh must not offer a retry.
      onClose();
      await onRefresh();
    } catch (caught) {
      const status = (caught as { status?: number }).status;
      if (status === 409) {
        setStale(true);
        setError("This dose changed on another device. Close and reopen to review the latest details.");
      } else {
        setError(caught instanceof Error ? caught.message : "Could not save this dose. Try again.");
      }
      await onRefresh();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} data-medication-entry-form="edit" aria-labelledby="medication-dose-edit-title" onCancel={event => { event.preventDefault(); requestClose(); }} onClick={event => { if (event.target === dialogRef.current) requestClose(); }} className="baby-care-dialog m-auto w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-0 text-warm-brown shadow-xl">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Pill aria-hidden="true" className="h-5 w-5 text-accent-strong" />
          <h2 id="medication-dose-edit-title" className="text-lg font-semibold">Edit medication dose</h2>
        </div>
        <button type="button" aria-label="Close dose editor" disabled={busy} onClick={requestClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-muted disabled:opacity-50"><X aria-hidden="true" className="h-5 w-5" /></button>
      </div>
      <form onSubmit={save} className="space-y-4 p-4">
        <p className="text-sm text-muted">{dose.medicationName}</p>
        {stale && <p role="status" className="text-xs text-warning">This dose is out of date. Close and reopen it from the diary to edit the latest version.</p>}
        <label className="block text-sm font-medium">Amount given
          <input required maxLength={120} value={doseText} disabled={busy || stale} onChange={event => setDoseText(event.target.value)} placeholder="Amount and unit, e.g. 3.5 ml" className="mt-2 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm font-medium">Time given (Singapore)
          <input required type="datetime-local" step="1" value={givenAt} disabled={busy || stale} onChange={event => setGivenAt(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
        </label>
        {invalidTime && <p role="alert" className="text-xs text-danger">Choose a time within this sick-mode episode, not in the future.</p>}
        <p className="text-xs leading-relaxed text-muted">Record the amount actually given. This form does not calculate or recommend a dose.</p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={busy || stale || invalidTime || !doseText.trim()} className="min-h-11 w-full rounded-lg bg-terracotta-dark px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save dose"}</button>
      </form>
    </dialog>
  );
}

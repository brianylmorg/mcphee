"use client";

import { useEffect, useId, useRef } from "react";
import { Baby, X } from "lucide-react";
import ChildcareModePanel, { type ChildcareModePanelProps } from "@/components/ChildcareModePanel";
import type { ChildcareSessionSummary } from "@/lib/childcare-mode-contract";

export interface ChildcareHeaderMenuProps extends ChildcareModePanelProps {
  importOpen: boolean;
}

export default function ChildcareHeaderMenu({ importOpen, onImport, babyName, ...panelProps }: ChildcareHeaderMenuProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(true);
  const titleId = useId();

  const isActive = panelProps.activeSession !== null;
  const hasPending = !isActive && panelProps.pendingSessions.length > 0;
  const statusLabel = isActive
    ? "Childcare status: in childcare"
    : hasPending
      ? "Childcare status: screenshot pending"
      : "Childcare status: not checked in";

  const close = () => dialogRef.current?.close();

  // Parent takes over for the OCR handoff: close without pulling focus back.
  useEffect(() => {
    if (importOpen && dialogRef.current?.open) {
      restoreFocusRef.current = false;
      dialogRef.current.close();
    }
  }, [importOpen]);

  const handleImport = (session: ChildcareSessionSummary) => {
    restoreFocusRef.current = false;
    dialogRef.current?.close();
    onImport(session);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-label={statusLabel}
        title={statusLabel}
        onClick={() => dialogRef.current?.showModal()}
        className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${isActive ? "bg-terracotta/10 text-accent-strong hover:bg-terracotta/20" : "text-muted hover:bg-surface-muted"}`}
      >
        <Baby aria-hidden="true" className="h-5 w-5" />
        {(isActive || hasPending) && (
          <span aria-hidden="true" className={`absolute right-1 top-1 h-2 w-2 rounded-full ${isActive ? "bg-terracotta" : "bg-terracotta/50"}`} />
        )}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => {
          if (restoreFocusRef.current) triggerRef.current?.focus();
          restoreFocusRef.current = true;
        }}
        onClick={event => {
          if (event.target === dialogRef.current) close();
        }}
        className="baby-care-dialog m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-0 text-left text-warm-brown shadow-xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold">
              Childcare status
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted">{babyName}</p>
          </div>
          <button
            type="button"
            aria-label="Close childcare status"
            onClick={close}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-muted"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4">
          <ChildcareModePanel babyName={babyName} onImport={handleImport} {...panelProps} />
        </div>
      </dialog>
    </>
  );
}

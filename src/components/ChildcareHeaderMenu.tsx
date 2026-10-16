"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
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
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="none">
          <path d="M9 11.6L21 20.6" stroke="#A9713F" strokeWidth="2.6" strokeLinecap="round"/>
          <path d="M9 6.8c-1.1 2.1-4.9 3.8-4.6 7.4.3 5.9 12.8 5.9 13.2 0 .3-3.6-3.5-5.3-4.6-7.4Z" fill="#F6C6CC" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
          <path d="M11 5.8C10.3 4.1 8.2 3.5 7.3 4.5C6.4 5.5 7.7 7 9.3 6.7C10.1 6.55 10.7 6.2 11 5.8Z" fill="#F6C6CC" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
          <path d="M11 5.8C11.7 4.1 13.8 3.5 14.7 4.5C15.6 5.5 14.3 7 12.7 6.7C11.9 6.55 11.3 6.2 11 5.8Z" fill="#F6C6CC" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
          <circle cx="11" cy="5.8" r="1.05" fill="#EEA3AD" stroke="currentColor" strokeWidth="1.1"/>
          <circle cx="9" cy="13.4" r="1" fill="#E4919D"/>
          <circle cx="12.9" cy="10.6" r="1" fill="#E4919D"/>
        </svg>
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

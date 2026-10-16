"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { StorybookBalloon, StorybookHome } from "@/components/StorybookArt";
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
  const statusLabel = isActive
    ? "Childcare status: in childcare"
    : "Childcare status: at home";

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
        className={`relative flex shrink-0 items-center justify-center rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40 ${isActive ? "h-14 w-11" : "h-16 w-[5.5rem]"}`}
      >
        {isActive
          ? <StorybookBalloon active className="h-12 w-10 -rotate-12" />
          : <StorybookHome className="h-16 w-[5.5rem]" />}
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
        className="baby-care-dialog m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface p-0 text-left text-warm-brown shadow-xl"
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

"use client";

import { StorybookBalloon, StorybookHome } from "@/components/StorybookArt";

/**
 * The childcare status picture beside the baby face: the home cottage at
 * home, the balloon at childcare. It opens the shared care sheet at its
 * Childcare section (the sheet itself lives in BabyCareMenu).
 */
export default function ChildcareStatusTrigger({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const statusLabel = active ? "Childcare status: in childcare" : "Childcare status: at home";
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={statusLabel}
      title={statusLabel}
      onClick={onOpen}
      className={`relative flex shrink-0 items-center justify-center rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40 ${active ? "h-14 w-11" : ""}`}
    >
      {active
        ? <StorybookBalloon active className="h-12 w-10 -rotate-12" />
        : <StorybookHome className="h-[5.25rem]" />}
    </button>
  );
}

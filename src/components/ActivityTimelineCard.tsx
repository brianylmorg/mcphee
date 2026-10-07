import type { LucideIcon } from "lucide-react";
import { Trash2 } from "lucide-react";

export interface ActivityTimelineCardProps {
  title: string;
  when: string;
  elapsed?: string;
  subcategory?: string;
  quantity?: string;
  comment?: string;
  createdBy?: string;
  icon: LucideIcon;
  /**
   * Notes carry their full literal text as the title; when true the title is
   * allowed to grow and wrap instead of being truncated to a single line.
   */
  multiline?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * Presentational activity diary row. Consolidates a typical entry into two
 * lines (icon + title + quantity, then timestamp/elapsed + subtype + creator)
 * while keeping full notes and comments visible when present.
 */
export default function ActivityTimelineCard({
  title,
  when,
  elapsed,
  subcategory,
  quantity,
  comment,
  createdBy,
  icon: Icon,
  multiline = false,
  onEdit,
  onDelete,
}: ActivityTimelineCardProps) {
  return (
    <div
      data-activity-card
      className="flex items-start gap-1.5 rounded-lg border border-border bg-surface p-1 transition-colors hover:border-terracotta/30"
    >
      <button
        type="button"
        onClick={onEdit}
        className="min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <span className="flex min-w-0 items-start gap-2">
          <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent-strong" />
          <span
            className={`min-w-0 flex-1 text-sm font-semibold text-warm-brown ${
              multiline ? "whitespace-pre-wrap break-words leading-snug" : "truncate"
            }`}
          >
            {title}
          </span>
          {quantity && (
            <span className="max-w-[50%] shrink-0 break-words text-right text-sm font-medium tabular-nums text-warm-brown">{quantity}</span>
          )}
        </span>
        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pl-6 text-xs text-muted">
          <span className="font-medium tabular-nums text-warm-brown-light">
            {elapsed ? `${when} · ${elapsed}` : when}
          </span>
          {subcategory && <span className="text-warm-brown-light">{subcategory}</span>}
          {createdBy && <span>Entered by {createdBy}</span>}
        </span>
        {comment && (
          <span className="mt-1 block whitespace-pre-wrap break-words border-l-2 border-terracotta/20 pl-2 text-xs leading-relaxed text-warm-brown-light">
            {comment}
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label={`Delete ${title.toLowerCase()} activity`}
        onClick={onDelete}
        className="flex min-h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-50 hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-red-200 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        title="Delete"
      >
        <Trash2 aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}

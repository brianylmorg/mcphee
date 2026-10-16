import type { LucideIcon } from "lucide-react";

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
  /**
   * Virtual caretaker care markers render as static rows: the layout is kept,
   * but the edit affordance, the delete action and every interactive style are
   * dropped.
   */
  readOnly?: boolean;
  /** Opens the entry's editor, which also holds its delete action. */
  onEdit: () => void;
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
  readOnly = false,
  onEdit,
}: ActivityTimelineCardProps) {
  // Shared row content. Read-only markers render it without any action chrome.
  const body = (
    <>
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
    </>
  );

  return (
    <div data-activity-card className="border-b border-border/70">
      {readOnly ? (
        <div className="min-w-0 px-1 py-2 text-left">{body}</div>
      ) : (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${title.toLowerCase()} activity`}
          className="block w-full min-w-0 rounded-md px-1 py-2 text-left transition-colors hover:bg-surface-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-terracotta/40"
        >
          {body}
        </button>
      )}
    </div>
  );
}

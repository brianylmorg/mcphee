const VOMIT_TYPE_LABELS: Record<string, string> = {
  projectile: "projectile",
  "dribble-milk": "dribble milk",
  "dribble-beancurd": "dribble beancurd",
};

/** Note details for a legacy vomit activity, e.g. "Vomit (projectile) – After coughing". */
export function vomitToNoteDetails(details: Record<string, unknown>): Record<string, unknown> {
  const kind = VOMIT_TYPE_LABELS[String(details.vomitType)];
  const extra = typeof details.notes === "string" ? details.notes.trim() : "";
  const notes = [kind ? `Vomit (${kind})` : "Vomit", extra].filter(Boolean).join(" – ");
  return { ...details, notes, legacyType: "vomit" };
}

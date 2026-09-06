export function activityNoteText(details: Record<string, unknown>): string {
  const value = typeof details.notes === "string"
    ? details.notes
    : typeof details.note === "string"
      ? details.note
      : "";

  return value.trim();
}

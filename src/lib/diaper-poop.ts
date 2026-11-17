/**
 * Diaper poo is stored three ways: "M"/"L" from the diaper form, "yes" from a
 * caretaker screenshot (size not shown), and `true` on old paper-log rows.
 */
export function diaperHasPoop(value: unknown): boolean {
  return value === "M" || value === "L" || value === "yes" || value === true;
}

/** "poop M", "poop L", or "poop" when the size is unknown; "" for no poo. */
export function diaperPoopQuantity(value: unknown): string {
  if (value === "M" || value === "L") return `poop ${value}`;
  return diaperHasPoop(value) ? "poop" : "";
}

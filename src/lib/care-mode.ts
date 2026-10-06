export const CARE_MODE_EVENT = "mcphee:care-mode";

export interface CareModeUpdate {
  householdId: string;
  babyId: string;
  active: boolean;
}

export function isCareModeUpdate(value: unknown): value is CareModeUpdate {
  if (!value || typeof value !== "object") return false;
  const update = value as Partial<CareModeUpdate>;
  return typeof update.householdId === "string" && update.householdId.length > 0
    && typeof update.babyId === "string" && update.babyId.length > 0
    && typeof update.active === "boolean";
}

export function publishCareMode(update: CareModeUpdate): void {
  window.dispatchEvent(new CustomEvent(CARE_MODE_EVENT, { detail: update }));
}

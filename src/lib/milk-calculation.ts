export type MlCalculation = {
  normalized: string;
  effectiveMl: number;
  wastedMl: number;
  libraryDeductionMl: number;
  hasCalculation: boolean;
};

const roundMl = (value: number): number => Math.round(value * 100) / 100;

function numericMl(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

export function parseMlCalculation(value: unknown): MlCalculation | null {
  const normalized = String(value ?? "").trim().replace(/\s+/g, "").replace(/ml$/i, "");
  if (!normalized || !/^\d+(?:\.\d+)?(?:[+-]\d+(?:\.\d+)?)*$/.test(normalized)) return null;

  const terms = normalized.match(/[+-]?\d+(?:\.\d+)?/g);
  if (!terms) return null;

  let effectiveMl = 0;
  let wastedMl = 0;
  let libraryDeductionMl = 0;

  terms.forEach((term) => {
    const amount = Math.abs(Number(term));
    if (term.startsWith("-")) {
      effectiveMl -= amount;
      wastedMl += amount;
    } else {
      effectiveMl += amount;
      libraryDeductionMl += amount;
    }
  });

  if (!Number.isFinite(effectiveMl) || effectiveMl <= 0) return null;

  return {
    normalized,
    effectiveMl: roundMl(effectiveMl),
    wastedMl: roundMl(wastedMl),
    libraryDeductionMl: roundMl(libraryDeductionMl),
    hasCalculation: terms.length > 1,
  };
}

export function bottleBreastmilkLibraryDeduction(details: Record<string, unknown>): number {
  if (Array.isArray(details.feeds)) {
    return details.feeds.reduce((total, item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return total;
      const feed = item as Record<string, unknown>;
      if (feed.milkType !== "breastmilk") return total;

      const consumedMl = numericMl(feed.amount);
      const wastedMl = numericMl(feed.wastedAmount);
      const storedDeductionMl = numericMl(feed.libraryDeductionAmount);
      const calculatedDeductionMl = parseMlCalculation(feed.amountExpression)?.libraryDeductionMl ?? 0;
      return total + Math.max(consumedMl + wastedMl, storedDeductionMl, calculatedDeductionMl);
    }, 0);
  }

  if (details.milkType === "formula") return 0;

  const consumedMl = Math.max(numericMl(details.breastmilkAmount), numericMl(details.amount));
  const wastedMl = numericMl(details.wastedAmount);
  const storedDeductionMl = numericMl(details.breastmilkLibraryDeductionAmount);
  const calculatedDeductionMl = parseMlCalculation(details.amountExpression)?.libraryDeductionMl ?? 0;
  return Math.max(consumedMl + wastedMl, storedDeductionMl, calculatedDeductionMl);
}

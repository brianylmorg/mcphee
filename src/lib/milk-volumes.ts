export type MilkVolumes = { breastmilkMl: number; formulaMl: number };

export function parseActivityDetails(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function numericMl(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

export function bottleVolumes(details: Record<string, unknown>): MilkVolumes {
  const feeds = details.feeds;
  if (Array.isArray(feeds)) {
    return feeds.reduce<MilkVolumes>((total, item) => {
      if (!item || typeof item !== "object") return total;
      const feed = item as Record<string, unknown>;
      const amount = numericMl(feed.amount);
      if (feed.milkType === "formula") total.formulaMl += amount;
      if (feed.milkType === "breastmilk") total.breastmilkMl += amount;
      return total;
    }, { breastmilkMl: 0, formulaMl: 0 });
  }

  const amount = numericMl(details.amount);
  const breastmilkAmount = numericMl(details.breastmilkAmount);
  const formulaAmount = numericMl(details.formulaAmount);

  if (breastmilkAmount || formulaAmount) {
    return {
      breastmilkMl: breastmilkAmount || (details.milkType === "breastmilk" ? amount : 0),
      formulaMl: formulaAmount || (details.milkType === "formula" ? amount : 0),
    };
  }

  if (details.milkType === "formula") return { breastmilkMl: 0, formulaMl: amount };
  return { breastmilkMl: amount, formulaMl: 0 };
}

export function pumpAmount(details: Record<string, unknown>): number {
  return numericMl(details.amount);
}

const sgtDateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function sgtDateKey(timestamp: number): string {
  const parts = sgtDateKeyFormatter.formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
  return [part("year"), part("month"), part("day")].join("-");
}

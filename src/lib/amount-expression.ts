import { parseMlCalculation } from "./milk-calculation";

// Evaluates a simple arithmetic entry such as "120-40" or "2*60+15" typed into an ml field.
// Supports + - * / and parentheses. Returns null for anything else or a non-finite result.
export function evaluateAmountExpression(input: string): number | null {
  const source = input.replace(/\s+/g, "").replace(/[−–]/g, "-").replace(/[×x]/gi, "*").replace(/÷/g, "/");
  if (!source || !/^[\d.+\-*/()]+$/.test(source)) return null;
  let index = 0;

  const peek = () => source[index];

  const parseNumber = (): number | null => {
    const match = /^(\d+(?:\.\d*)?|\.\d+)/.exec(source.slice(index));
    if (!match) return null;
    index += match[0].length;
    return Number(match[0]);
  };

  const parseFactor = (): number | null => {
    if (peek() === "-") { index++; const value = parseFactor(); return value == null ? null : -value; }
    if (peek() === "+") { index++; return parseFactor(); }
    if (peek() === "(") {
      index++;
      const value = parseSum();
      if (value == null || peek() !== ")") return null;
      index++;
      return value;
    }
    return parseNumber();
  };

  const parseProduct = (): number | null => {
    let value = parseFactor();
    while (value != null && (peek() === "*" || peek() === "/")) {
      const operator = source[index++];
      const right = parseFactor();
      if (right == null) return null;
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };

  function parseSum(): number | null {
    let value = parseProduct();
    while (value != null && (peek() === "+" || peek() === "-")) {
      const operator = source[index++];
      const right = parseProduct();
      if (right == null) return null;
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  }

  const result = parseSum();
  if (result == null || index !== source.length || !Number.isFinite(result)) return null;
  return Math.round(result * 10) / 10;
}

export function isAmountExpression(input: string): boolean {
  return /\d\s*[+\-−–*×x/÷]/i.test(input.trim().replace(/^[-−–]/, ""));
}

export const BOTTLE_AMOUNT_DETAIL_KEYS = ["amount", "amountExpression", "wastedAmount"] as const;

// Bottle details for an ml entry, stored the way the regular bottle form stores them.
// "150-40" keeps the sum and the 40 ml wastage, so the milk bank deducts 150 ml
// while the day counts 110 ml consumed. Sums with * / or brackets save only the result.
export function bottleAmountDetails(input: string): Record<string, number | string> | null {
  const calculation = parseMlCalculation(input.replace(/[−–]/g, "-"));
  if (calculation) {
    return {
      amount: calculation.effectiveMl,
      ...(calculation.hasCalculation ? { amountExpression: calculation.normalized } : {}),
      ...(calculation.wastedMl > 0 ? { wastedAmount: calculation.wastedMl } : {}),
    };
  }
  const amount = evaluateAmountExpression(input);
  return amount != null ? { amount } : null;
}

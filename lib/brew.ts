export type CalculatorMode = "water" | "coffee";

export type BrewPreferences = {
  mode: CalculatorMode;
  waterMl: number;
  coffeeGrams: number;
  ratio: number;
};

export type ParsedValue =
  | { kind: "empty" | "incomplete" | "invalid" }
  | { kind: "valid"; value: number };

const RESULT_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export const BREW_LIMITS = {
  waterMl: { min: 1, max: 10_000 },
  coffeeGrams: { min: 0.1, max: 1_000 },
  ratio: { min: 1, max: 100 },
  decimalPlaces: 3,
} as const;

const DECIMAL_PATTERN = new RegExp(`^\\d+(?:[.,]\\d{1,${BREW_LIMITS.decimalPlaces}})?$`);

export const DEFAULT_BREW_PREFERENCES: BrewPreferences = {
  mode: "water",
  waterMl: 250,
  coffeeGrams: 15,
  ratio: 16,
};

function parseDecimal(raw: string, min: number, max: number): ParsedValue {
  const value = raw.trim();
  if (!value) return { kind: "empty" };
  if (/^\d+[.,]$/.test(value)) return { kind: "incomplete" };
  if (!DECIMAL_PATTERN.test(value)) return { kind: "invalid" };
  const number = Number(value.replace(",", "."));
  return Number.isFinite(number) && number >= min && number <= max
    ? { kind: "valid", value: number }
    : { kind: "invalid" };
}

export function parseBrewAmount(raw: string, mode: CalculatorMode): ParsedValue {
  const limits = mode === "water" ? BREW_LIMITS.waterMl : BREW_LIMITS.coffeeGrams;
  return parseDecimal(raw, limits.min, limits.max);
}

export function parseRatio(raw: string): ParsedValue {
  return parseDecimal(raw, BREW_LIMITS.ratio.min, BREW_LIMITS.ratio.max);
}

export function calculateCoffeeGrams(waterMl: number, ratio: number): number {
  return Math.round((waterMl / ratio) * 10) / 10;
}

export function formatBrewResult(value: number, unit: "grams" | "ml"): string {
  if (value === 0) return `<${unit === "grams" ? "0.1 grams" : "1 ml"}`;
  return `${RESULT_FORMAT.format(value)} ${unit}`;
}

export function calculateWaterMl(coffeeGrams: number, ratio: number): number {
  return Math.round(coffeeGrams * ratio);
}

export function calculateBloomWaterMl(coffeeGrams: number): number {
  return Math.round(coffeeGrams * 2);
}

function storedNumber(value: unknown, mode: CalculatorMode | "ratio", fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const parsed = mode === "ratio" ? parseRatio(String(value)) : parseBrewAmount(String(value), mode);
  return parsed.kind === "valid" ? parsed.value : fallback;
}

export function readBrewPreferences(serialized: string | null): BrewPreferences {
  if (!serialized) return { ...DEFAULT_BREW_PREFERENCES };

  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ...DEFAULT_BREW_PREFERENCES };
    }

    const saved = value as Record<string, unknown>;
    return {
      mode: saved.mode === "coffee" || saved.mode === "water" ? saved.mode : DEFAULT_BREW_PREFERENCES.mode,
      waterMl: storedNumber(saved.waterMl, "water", DEFAULT_BREW_PREFERENCES.waterMl),
      coffeeGrams: storedNumber(saved.coffeeGrams, "coffee", DEFAULT_BREW_PREFERENCES.coffeeGrams),
      ratio: storedNumber(saved.ratio, "ratio", DEFAULT_BREW_PREFERENCES.ratio),
    };
  } catch {
    return { ...DEFAULT_BREW_PREFERENCES };
  }
}

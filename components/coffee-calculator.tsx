"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  calculateBloomWaterMl,
  calculateCoffeeGrams,
  calculateWaterMl,
  BREW_LIMITS,
  formatBrewResult,
  parseBrewAmount,
  parseRatio,
  readBrewPreferences,
  type BrewPreferences,
  type CalculatorMode,
  type ParsedValue,
} from "@/lib/brew";

const STORAGE_KEY = "coffee-calculator:preferences:v1";

type CalculatorDrafts = {
  water?: string;
  coffee?: string;
  ratio?: string;
};

type CalculatorDraftState = {
  preferences: BrewPreferences;
  drafts: CalculatorDrafts;
};

function synchronizeDrafts(
  state: CalculatorDraftState,
  preferences: BrewPreferences,
): CalculatorDraftState {
  if (
    state.preferences.mode === preferences.mode &&
    state.preferences.waterMl === preferences.waterMl &&
    state.preferences.coffeeGrams === preferences.coffeeGrams &&
    state.preferences.ratio === preferences.ratio
  ) return state;

  let drafts = state.drafts;
  if (state.preferences.waterMl !== preferences.waterMl && drafts.water !== undefined) {
    const parsed = parseBrewAmount(drafts.water, "water");
    if (parsed.kind !== "valid" || parsed.value !== preferences.waterMl) {
      drafts = { ...drafts };
      delete drafts.water;
    }
  }
  if (state.preferences.coffeeGrams !== preferences.coffeeGrams && drafts.coffee !== undefined) {
    const parsed = parseBrewAmount(drafts.coffee, "coffee");
    if (parsed.kind !== "valid" || parsed.value !== preferences.coffeeGrams) {
      drafts = { ...drafts };
      delete drafts.coffee;
    }
  }
  if (state.preferences.ratio !== preferences.ratio && drafts.ratio !== undefined) {
    const parsed = parseRatio(drafts.ratio);
    if (parsed.kind !== "valid" || parsed.value !== preferences.ratio) {
      drafts = { ...drafts };
      delete drafts.ratio;
    }
  }

  return { preferences, drafts };
}

const preferenceListeners = new Set<() => void>();
let volatilePreferences: string | null = null;
let useVolatilePreferences = false;

function getPreferenceSnapshot() {
  if (useVolatilePreferences) return volatilePreferences;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    useVolatilePreferences = true;
    return volatilePreferences;
  }
}

function getServerPreferenceSnapshot() {
  return null;
}

function subscribeToPreferences(listener: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  preferenceListeners.add(listener);
  window.addEventListener("storage", handleStorage);
  return () => {
    preferenceListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function savePreferences(preferences: BrewPreferences) {
  const serialized = JSON.stringify(preferences);
  volatilePreferences = serialized;
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized);
    useVolatilePreferences = false;
  } catch {
    useVolatilePreferences = true;
  }
  preferenceListeners.forEach(listener => listener());
}

function updatePreferences(changes: Partial<BrewPreferences>) {
  savePreferences({ ...readBrewPreferences(getPreferenceSnapshot()), ...changes });
}

const WATER_PRESETS = [
  { label: "250 ml", value: 250 },
  { label: "500 ml", value: 500 },
  { label: "750 ml", value: 750 },
];
const COFFEE_PRESETS = [
  { label: "15 g", value: 15 },
  { label: "30 g", value: 30 },
  { label: "45 g", value: 45 },
];
const RATIO_PRESETS = [15, 16, 17, 18].map(value => ({
  label: `1:${value}`,
  value,
}));
const DECIMAL_PLACES = BREW_LIMITS.decimalPlaces;


type PresetButtonProps = {
  presets: Array<{ label: string; value: number }>;
  currentValue?: number;
  onSelect: (value: number) => void;
  label: string;
};

const PresetButtons = ({ presets, currentValue, onSelect, label }: PresetButtonProps) => (
  <div
    role="group"
    aria-label={label}
    className={`grid min-w-0 gap-2 ${
      presets.length === 4
        ? "grid-cols-2 min-[240px]:grid-cols-4"
        : "grid-cols-2 min-[320px]:grid-cols-3"
    }`}>
    {presets.map(preset => (
      <Button
        key={preset.label}
        type="button"
        variant={currentValue === preset.value ? "default" : "outline"}
        size="default"
        className="h-11 min-w-0 px-1 text-xs sm:px-2 sm:text-sm"
        aria-pressed={currentValue === preset.value}
        onClick={() => onSelect(preset.value)}>
        {preset.label}
      </Button>
    ))}
  </div>
);

function amountLimits(mode: CalculatorMode) {
  return mode === "water" ? "1–10,000 ml" : "0.1–1,000 g";
}

function validationMessage(kind: ParsedValue["kind"], limits: string) {
  if (kind === "incomplete") return "Finish entering the decimal value.";
  if (kind === "invalid") return `Use ${limits}, with up to ${DECIMAL_PLACES} decimal places.`;
  return "";
}

function resultPrompt(kind: ParsedValue["kind"], subject: string, limits: string) {
  if (kind === "empty") return `Enter ${subject} to see the recipe.`;
  return validationMessage(kind, limits);
}

export function CoffeeCalculatorComponent() {
  const serializedPreferences = useSyncExternalStore(
    subscribeToPreferences,
    getPreferenceSnapshot,
    getServerPreferenceSnapshot,
  );
  const preferences = useMemo(() => readBrewPreferences(serializedPreferences), [serializedPreferences]);
  const [draftState, setDraftState] = useState<CalculatorDraftState>({ preferences, drafts: {} });
  const synchronizedDraftState = useMemo(
    () => synchronizeDrafts(draftState, preferences),
    [draftState, preferences],
  );
  const drafts = synchronizedDraftState.drafts;
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      const incomingPreferences = readBrewPreferences(event.newValue);
      setDraftState(previous => synchronizeDrafts(previous, incomingPreferences));
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);
  const updateDrafts = (changes: CalculatorDrafts) => {
    setDraftState(previous => ({
      preferences,
      drafts: { ...synchronizeDrafts(previous, preferences).drafts, ...changes },
    }));
  };
  const mode = preferences.mode;
  const waterInput = drafts.water ?? String(preferences.waterMl);
  const coffeeInput = drafts.coffee ?? String(preferences.coffeeGrams);
  const ratioInput = drafts.ratio ?? String(preferences.ratio);
  const amountInput = mode === "water" ? waterInput : coffeeInput;
  const amountValue = parseBrewAmount(amountInput, mode);
  const ratioValue = parseRatio(ratioInput);
  const customRatioSuffix =
    ratioValue.kind === "valid" && !RATIO_PRESETS.some(preset => preset.value === ratioValue.value)
      ? ` (1:${ratioInput})`
      : "";
  const amountPresets = mode === "water" ? WATER_PRESETS : COFFEE_PRESETS;
  const limits = amountLimits(mode);
  const amountLabel = mode === "water" ? "Water (ml)" : "Coffee (g)";
  const amountError = validationMessage(amountValue.kind, limits);
  const ratioError = validationMessage(ratioValue.kind, "a ratio from 1–100");
  const resultValue =
    amountValue.kind === "valid" && ratioValue.kind === "valid"
      ? mode === "water"
        ? calculateCoffeeGrams(amountValue.value, ratioValue.value)
        : calculateWaterMl(amountValue.value, ratioValue.value)
      : undefined;
  const resultMessage =
    amountValue.kind !== "valid"
      ? resultPrompt(
          amountValue.kind,
          mode === "water" ? "a water amount" : "a coffee amount",
          limits,
        )
      : ratioValue.kind !== "valid"
        ? resultPrompt(ratioValue.kind, "a coffee-to-water ratio", "a ratio from 1–100")
        : "";
  const resultUnit = mode === "water" ? "grams" : "ml";
  const recipeIsValid = resultValue !== undefined;

  const updateAmount = (next: string) => {
    const inputKey = mode === "water" ? "water" : "coffee";
    updateDrafts({ [inputKey]: next });
    const parsed = parseBrewAmount(next, mode);
    if (parsed.kind === "valid") {
      updatePreferences({
        [mode === "water" ? "waterMl" : "coffeeGrams"]: parsed.value,
      });
    }
  };

  const selectAmountPreset = (value: number) => {
    const inputKey = mode === "water" ? "water" : "coffee";
    updateDrafts({ [inputKey]: String(value) });
    updatePreferences({ [mode === "water" ? "waterMl" : "coffeeGrams"]: value });
  };

  const selectRatio = (value: number) => {
    updateDrafts({ ratio: String(value) });
    updatePreferences({ ratio: value });
  };

  return (
    <main
      className="flex min-h-dvh items-start justify-center bg-neutral-900 sm:items-center"
      style={{
        paddingTop: "max(env(safe-area-inset-top), 1rem)",
        paddingRight: "max(env(safe-area-inset-right), 1rem)",
        paddingBottom: "max(env(safe-area-inset-bottom), 1rem)",
        paddingLeft: "max(env(safe-area-inset-left), 1rem)",
      }}>
      <Card className="w-full max-w-none rounded-none border-0 bg-transparent dark:bg-transparent text-neutral-50 shadow-none sm:max-w-md sm:rounded-xl sm:border sm:border-neutral-800 sm:bg-white sm:dark:bg-neutral-950 sm:shadow-sm">
        <CardHeader className="p-0 pb-3 sm:p-6">
          <h1 className="text-xl font-bold sm:text-2xl">Coffee-to-Water Ratio Calculator</h1>
          <CardDescription>Brew by water, coffee, or ratio.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          <div className="space-y-2 sm:space-y-5">
            <fieldset className="min-w-0 space-y-2 border-0 p-0">
              <legend className="mb-2 text-sm font-medium">Calculate from</legend>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={mode === "water" ? "default" : "outline"}
                  className="h-11"
                  aria-pressed={mode === "water"}
                  onClick={() => updatePreferences({ mode: "water" })}>
                  Water
                </Button>
                <Button
                  type="button"
                  variant={mode === "coffee" ? "default" : "outline"}
                  className="h-11"
                  aria-pressed={mode === "coffee"}
                  onClick={() => updatePreferences({ mode: "coffee" })}>
                  Coffee
                </Button>
              </div>
            </fieldset>

            <div className="min-w-0 space-y-2">
              <Label htmlFor="brew-amount">{amountLabel}</Label>
              <PresetButtons
                presets={amountPresets}
                currentValue={amountValue.kind === "valid" ? amountValue.value : undefined}
                onSelect={selectAmountPreset}
                label={mode === "water" ? "Water amount presets" : "Coffee amount presets"}
              />
              <Input
                id="brew-amount"
                type="text"
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                className="h-11 text-lg tabular-nums sm:h-12"
                value={amountInput}
                aria-invalid={amountValue.kind === "invalid" || undefined}
                aria-describedby={
                  amountValue.kind === "invalid" || amountValue.kind === "incomplete"
                    ? "amount-help amount-error"
                    : "amount-help"
                }
                onChange={event => updateAmount(event.currentTarget.value)}
                onKeyDown={event => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
              <p id="amount-help" className="text-xs text-neutral-500 dark:text-neutral-400">
                {limits}; enter decimals with a dot or comma (up to {DECIMAL_PLACES} decimal places).
              </p>
              {amountError && (
                <p id="amount-error" className="text-sm text-red-700 dark:text-red-300">
                  {amountError}
                </p>
              )}
            </div>
            <section aria-labelledby="result-heading" className="rounded-lg bg-neutral-100 p-3 dark:bg-neutral-900 sm:p-4">
              <h2 id="result-heading" className="text-sm font-medium">
                {mode === "water" ? "Coffee Grounds Needed" : "Water Needed"}
              </h2>
              <p role="status" aria-live="polite" aria-atomic="true" className="mt-1 min-h-10 text-2xl font-bold tabular-nums">
                {resultValue !== undefined ? formatBrewResult(resultValue, resultUnit) : resultMessage}
              </p>
              {recipeIsValid && amountValue.kind === "valid" && ratioValue.kind === "valid" && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Bloom water (about 2× coffee):{" "}
                  {formatBrewResult(
                    calculateBloomWaterMl(
                      mode === "water" ? calculateCoffeeGrams(amountValue.value, ratioValue.value) : amountValue.value,
                    ),
                    "ml",
                  )}
                </p>
              )}
            </section>

            <fieldset className="min-w-0 space-y-2 border-0 p-0">
              <legend className="mb-2 text-sm font-medium">Coffee-to-Water Ratio</legend>
              <PresetButtons
                presets={RATIO_PRESETS}
                currentValue={ratioValue.kind === "valid" ? ratioValue.value : undefined}
                onSelect={selectRatio}
                label="Common coffee-to-water ratios"
              />
              <details className="space-y-2">
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-950 focus-visible:outline-offset-2 dark:focus-visible:outline-neutral-300">
                  Custom ratio{customRatioSuffix}
                </summary>
                <div className="space-y-2">
                  <Label htmlFor="custom-ratio">Custom ratio (water per 1 part coffee)</Label>
                  <div className="flex h-12 items-center gap-3 rounded-md border border-neutral-200 bg-transparent px-3 shadow-xs focus-within:ring-2 focus-within:ring-neutral-500 focus-within:ring-offset-2 focus-within:ring-offset-white dark:border-neutral-800 dark:focus-within:ring-neutral-300 dark:focus-within:ring-offset-neutral-950">
                    <span aria-hidden="true" className="text-base font-medium">
                      1:
                    </span>
                    <Input
                      id="custom-ratio"
                      type="text"
                      inputMode="decimal"
                      enterKeyHint="done"
                      autoComplete="off"
                      className="h-full border-0 px-0 shadow-none focus-visible:ring-0 dark:border-0"
                      value={ratioInput}
                      aria-invalid={ratioValue.kind === "invalid" || undefined}
                      aria-describedby={
                        ratioValue.kind === "invalid" || ratioValue.kind === "incomplete"
                          ? "ratio-help ratio-error"
                          : "ratio-help"
                      }
                      onChange={event => {
                        const next = event.currentTarget.value;
                        updateDrafts({ ratio: next });
                        const parsed = parseRatio(next);
                        if (parsed.kind === "valid") updatePreferences({ ratio: parsed.value });
                      }}
                      onKeyDown={event => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  </div>
                  <p id="ratio-help" className="text-xs text-neutral-500 dark:text-neutral-400">
                    Enter a ratio from 1–100, with up to {DECIMAL_PLACES} decimal places.
                  </p>
                  {ratioError && (
                    <p id="ratio-error" className="text-sm text-red-700 dark:text-red-300">
                      {ratioError}
                    </p>
                  )}
                </div>
              </details>
            </fieldset>

          </div>
        </CardContent>
      </Card>
    </main>
  );
}


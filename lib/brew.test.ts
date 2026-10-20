import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_BREW_PREFERENCES,
  calculateBloomWaterMl,
  calculateCoffeeGrams,
  calculateWaterMl,
  formatBrewResult,
  parseBrewAmount,
  parseRatio,
  readBrewPreferences,
} from "./brew";

describe("brew calculator values", () => {
  it("accepts supported decimal input and rejects incomplete, malformed, and out-of-range values", () => {
    assert.deepEqual(parseBrewAmount("250,5", "water"), { kind: "valid", value: 250.5 });
    assert.deepEqual(parseBrewAmount("0,1", "coffee"), { kind: "valid", value: 0.1 });
    assert.deepEqual(parseRatio("16,5"), { kind: "valid", value: 16.5 });
    assert.deepEqual(parseBrewAmount("1", "water"), { kind: "valid", value: 1 });
    assert.deepEqual(parseBrewAmount("10,000", "water"), { kind: "valid", value: 10 });
    assert.deepEqual(parseBrewAmount("10000", "water"), { kind: "valid", value: 10_000 });
    assert.deepEqual(parseBrewAmount("1000", "coffee"), { kind: "valid", value: 1_000 });
    assert.deepEqual(parseRatio("100"), { kind: "valid", value: 100 });
    assert.deepEqual(parseBrewAmount("", "water"), { kind: "empty" });
    assert.deepEqual(parseRatio("16,"), { kind: "incomplete" });
    for (const input of ["0", "10000.001", "1.1234", "-1", "1e3", "coffee"]) {
      assert.equal(parseBrewAmount(input, "water").kind, "invalid", input);
    }
    assert.equal(parseBrewAmount("0", "coffee").kind, "invalid");
    assert.equal(parseBrewAmount("1000.001", "coffee").kind, "invalid");
    assert.equal(parseRatio("0.9").kind, "invalid");
    assert.equal(parseRatio("100.001").kind, "invalid");
  });

  it("calculates and displays water, coffee, and two-times-dose bloom values", () => {
    assert.equal(calculateCoffeeGrams(250, 16), 15.6);
    assert.equal(calculateCoffeeGrams(500.5, 16.5), 30.3);
    assert.equal(calculateWaterMl(15, 16), 240);
    assert.equal(calculateBloomWaterMl(15.6), 31);
    assert.equal(formatBrewResult(calculateCoffeeGrams(1, 100), "grams"), "<0.1 grams");
    assert.equal(formatBrewResult(calculateWaterMl(0.1, 1), "ml"), "<1 ml");
    assert.equal(formatBrewResult(calculateBloomWaterMl(0.1), "ml"), "<1 ml");
  });

  it("restores valid per-mode choices and safely defaults corrupt or invalid storage", () => {
    assert.deepEqual(readBrewPreferences(null), DEFAULT_BREW_PREFERENCES);
    assert.deepEqual(readBrewPreferences("not-json"), DEFAULT_BREW_PREFERENCES);
    assert.deepEqual(readBrewPreferences(JSON.stringify({
      mode: "coffee",
      waterMl: 500.5,
      coffeeGrams: 30.5,
      ratio: 16.5,
    })), { mode: "coffee", waterMl: 500.5, coffeeGrams: 30.5, ratio: 16.5 });
    assert.deepEqual(
      readBrewPreferences(JSON.stringify({ mode: "coffee", waterMl: -1, coffeeGrams: 0, ratio: 200 })),
      { ...DEFAULT_BREW_PREFERENCES, mode: "coffee" },
    );
    assert.deepEqual(readBrewPreferences("[]"), DEFAULT_BREW_PREFERENCES);
  });
});

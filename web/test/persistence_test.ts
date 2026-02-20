import { assertEquals } from "@std/assert";
import {
  getStoredBoolean,
  getStoredNumberWithLegacyScaling,
  getStoredString,
} from "../src/persistence.ts";

Deno.test("stored numeric values preserve explicit zero values", () => {
  const params = {
    j: "0",
    m: "0",
    timeScale: "0",
    temp: "0",
  };

  assertEquals(getStoredNumberWithLegacyScaling(params, "j", 20), 0);
  assertEquals(getStoredNumberWithLegacyScaling(params, "m", 10), 0);
  assertEquals(getStoredNumberWithLegacyScaling(params, "timeScale", 10), 0);
  assertEquals(getStoredNumberWithLegacyScaling(params, "temp", 2), 0);
});

Deno.test("stored numeric values apply legacy scale migration by threshold", () => {
  const params = {
    j: "125",
    m: "250",
    timeScale: "150",
    temp: "50",
  };

  assertEquals(getStoredNumberWithLegacyScaling(params, "j", 20), 1.25);
  assertEquals(getStoredNumberWithLegacyScaling(params, "m", 10), 2.5);
  assertEquals(getStoredNumberWithLegacyScaling(params, "timeScale", 10), 1.5);
  assertEquals(getStoredNumberWithLegacyScaling(params, "temp", 2), 0.5);
});

Deno.test("stored value helpers handle missing and typed values safely", () => {
  const params = {
    lSide: 24,
    preset: "Random Angles",
    showArrows: true,
  };

  assertEquals(getStoredString(params, "lSide"), "24");
  assertEquals(getStoredString(params, "preset"), "Random Angles");
  assertEquals(getStoredString(params, "missing"), undefined);
  assertEquals(getStoredBoolean(params, "showArrows"), true);
  assertEquals(getStoredBoolean(params, "missing"), undefined);
});

Deno.test("preset-specific parameters k, p2, p3 are correctly retrieved", () => {
  const params = {
    k: "1.5",
    p2: "10",
    p3: "-0.5",
  };

  assertEquals(getStoredString(params, "k"), "1.5");
  assertEquals(getStoredString(params, "p2"), "10");
  assertEquals(getStoredString(params, "p3"), "-0.5");
});

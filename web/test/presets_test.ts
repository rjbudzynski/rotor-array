import { assert, assertAlmostEquals } from "@std/assert";
import { generateInitialState, PRESETS } from "../src/presets.ts";

Deno.test("Presets generate arrays with correct sizes and bounds", () => {
  const l = 6;
  const n = l * l;
  for (const preset of PRESETS) {
    const { theta, omega } = generateInitialState(
      l,
      preset.name,
      2.5,
      3.0,
      0.5,
      0.0,
    );
    assert(theta.length === n);
    assert(omega.length === n);
    for (let i = 0; i < n; i++) {
      assert(Number.isFinite(theta[i]));
      assert(Number.isFinite(omega[i]));
      assert(theta[i] >= -Math.PI - 1e-12);
      assert(theta[i] < Math.PI + 1e-12);
    }
  }
});

Deno.test("Random Angles preset stays within [-pi, pi) and zero omega", () => {
  const { theta, omega } = generateInitialState(8, "Random Angles", 0, 0, 0, 0);
  for (let i = 0; i < theta.length; i++) {
    assert(theta[i] >= -Math.PI);
    assert(theta[i] < Math.PI);
    assertAlmostEquals(omega[i], 0);
  }
});

Deno.test("Domain Wall preset produces two distinct regions", () => {
  const l = 6;
  const { theta } = generateInitialState(l, "Domain Wall", 0, 0, 0, 0);
  const half = Math.floor(l / 2);
  for (let r = 0; r < l; r++) {
    for (let c = 0; c < l; c++) {
      const t = theta[r * l + c];
      if (r >= half) {
        // Wrapped PI becomes -PI
        assert(Math.abs(Math.abs(t) - Math.PI) < 1e-12);
      } else {
        assertAlmostEquals(t, 0, 1e-12);
      }
    }
  }
});

Deno.test("Pi/2 Domain Wall preset produces two distinct regions (+/- PI/2)", () => {
  const l = 6;
  const { theta } = generateInitialState(l, "Pi/2 Domain Wall", 0, 0, 0, 0);
  const half = Math.floor(l / 2);
  for (let r = 0; r < l; r++) {
    for (let c = 0; c < l; c++) {
      const t = theta[r * l + c];
      if (r < half) {
        assertAlmostEquals(t, Math.PI / 2, 1e-12);
      } else {
        assertAlmostEquals(t, -Math.PI / 2, 1e-12);
      }
    }
  }
});

Deno.test("Thermalized preset produces non-zero omega variance", () => {
  const { omega } = generateInitialState(10, "Thermalized", 1.0, 0, 0, 0);
  let mean = 0;
  for (const w of omega) mean += w;
  mean /= omega.length;
  let variance = 0;
  for (const w of omega) variance += (w - mean) ** 2;
  variance /= omega.length;
  assert(variance > 0);
});

Deno.test("Thermal noise overlay perturbs omega", () => {
  const { omega } = generateInitialState(6, "Random Angles", 0, 0, 0, 0.5);
  let nonZero = 0;
  for (const w of omega) {
    if (Math.abs(w) > 1e-8) nonZero++;
  }
  assert(nonZero > 0);
});

Deno.test("Single Kick preset injects a velocity peak", () => {
  const { theta, omega } = generateInitialState(9, "Single Kick", 5.0, 0, 0, 0);
  let maxOmega = -Infinity;
  for (const w of omega) maxOmega = Math.max(maxOmega, w);
  assert(maxOmega > 0);
  for (const t of theta) {
    assert(Math.abs(t) <= Math.PI);
  }
});

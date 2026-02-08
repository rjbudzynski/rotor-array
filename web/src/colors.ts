import {
  LUT_ANGLE_STEPS,
  LUT_ENERGY_STEPS,
  LUT_MAX_ENERGY,
  HUE_OFFSET,
  ENERGY_SCALE_FACTOR,
} from "./constants.ts";

/**
 * Convert rotor angle (theta) to hue value for visualization.
 * @param theta - Rotor angle in radians
 * @returns Hue value in range [0, 1]
 */
export function thetaToHue(theta: number): number {
  // theta=0 is down. We want theta=0 -> Blue (approx 0.666)
  // and theta=pi -> Yellow (approx 0.166)
  let h = (theta / (2 * Math.PI) + HUE_OFFSET) % 1.0;
  if (h < 0) h += 1;
  return h;
}

/**
 * Convert omega² (kinetic energy) to value (luminosity) for visualization.
 * @param omegaSq - Square of angular velocity
 * @param valMin - Minimum value (default 0.4)
 * @param valMax - Maximum value (default 0.8)
 * @returns Value in range [valMin, valMax]
 */
export function omegaToValue(
  omegaSq: number,
  valMin = 0.4,
  valMax = 0.8,
): number {
  const energyFactor = Math.tanh(omegaSq / ENERGY_SCALE_FACTOR);
  return valMin + (valMax - valMin) * energyFactor;
}

// Pre-compute a LUT for (Angle x Energy) -> RGB
// Angles: 360 steps (0 to 2pi)
// Energy: 64 steps (0 to ~10)
const ANG_STEPS = LUT_ANGLE_STEPS;
const ENG_STEPS = LUT_ENERGY_STEPS;
const LUT = new Uint8Array(ANG_STEPS * ENG_STEPS * 3);

for (let a = 0; a < ANG_STEPS; a++) {
  const theta = (a / ANG_STEPS) * 2 * Math.PI;
  const hue = thetaToHue(theta);
  for (let e = 0; e < ENG_STEPS; e++) {
    // Map 0..63 to energy 0..10
    const energy = (e / (ENG_STEPS - 1)) * LUT_MAX_ENERGY;
    const val = omegaToValue(energy);

    const offset = (a * ENG_STEPS + e) * 3;
    hsvToRgb(hue, 1.0, val, LUT, offset);
  }
}

/**
 * Get RGB color from LUT based on angle and kinetic energy.
 * @param theta - Rotor angle in radians
 * @param omegaSq - Square of angular velocity (kinetic energy)
 * @param out - Output buffer for RGB values
 * @param offset - Offset into output buffer
 */
export function getLutColor(
  theta: number,
  omegaSq: number,
  out: Uint8Array | Uint8ClampedArray,
  offset: number,
) {
  // Normalize theta to [0, 2pi)
  let aNorm = theta % (2 * Math.PI);
  if (aNorm < 0) aNorm += 2 * Math.PI;
  const aIdx = Math.floor((aNorm / (2 * Math.PI)) * ANG_STEPS) % ANG_STEPS;

  // Normalize energy to [0, LUT_MAX_ENERGY]
  const eIdx = Math.min(
    ENG_STEPS - 1,
    Math.floor((omegaSq / LUT_MAX_ENERGY) * ENG_STEPS),
  );

  const lutOffset = (aIdx * ENG_STEPS + eIdx) * 3;
  out[offset] = LUT[lutOffset];
  out[offset + 1] = LUT[lutOffset + 1];
  out[offset + 2] = LUT[lutOffset + 2];
}

/**
 * Convert HSV color to RGB.
 * @param h - Hue in range [0, 1]
 * @param s - Saturation in range [0, 1]
 * @param v - Value in range [0, 1]
 * @param out - Output buffer for RGB values
 * @param offset - Offset into output buffer
 */
export function hsvToRgb(
  h: number,
  s: number,
  v: number,
  out: Uint8Array | Uint8ClampedArray,
  offset: number,
) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  let r = 0, g = 0, b = 0;
  const ii = i % 6;

  switch (ii) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
  }

  out[offset] = Math.floor(r * 255);
  out[offset + 1] = Math.floor(g * 255);
  out[offset + 2] = Math.floor(b * 255);
}

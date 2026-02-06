export interface PresetInfo {
  name: string;
  kLabel?: string;
  kDecimals: number;
  kStep: number;
  kMin: number;
  kMax: number;
  kDefault: number | ((l: number) => number);

  p2Label?: string;
  p2Decimals: number;
  p2Step: number;
  p2Min: number;
  p2Max: number;
  p2Default: number | ((l: number) => number);

  p3Label?: string;
  p3Decimals: number;
  p3Step: number;
  p3Min: number;
  p3Max: number;
  p3Default: number | ((l: number) => number);
}

const DEFAULT_PRESET: PresetInfo = {
  name: "Default",
  kLabel: "Parameter:",
  kDecimals: 2,
  kStep: 0.1,
  kMin: -1000,
  kMax: 1000,
  kDefault: 1.0,
  p2Decimals: 0,
  p2Step: 1,
  p2Min: 1,
  p2Max: 1000,
  p2Default: 1,
  p3Decimals: 2,
  p3Step: 0.1,
  p3Min: -Math.PI,
  p3Max: Math.PI,
  p3Default: 0,
};

function createPreset(base: Partial<PresetInfo>): PresetInfo {
  return { ...DEFAULT_PRESET, ...base };
}

export const PRESETS: PresetInfo[] = [
  createPreset({ name: "Random Angles" }),
  createPreset({
    name: "Twisted",
    kLabel: "Winding (k):",
    kDecimals: 0,
    kStep: 1.0,
    kDefault: 1.0,
  }),
  createPreset({ name: "Domain Wall" }),
  createPreset({ name: "Pi/2 Domain Wall" }),
  createPreset({
    name: "Vortex Band",
    kLabel: "Wraps (k):",
    kDecimals: 0,
    kStep: 1.0,
    kDefault: 1.0,
    p2Label: "Width (w):",
    p2Default: 1.0,
    p3Label: "Shift (δφ):",
    p3Default: 0.0,
  }),
  createPreset({ name: "Cross Domain" }),
  createPreset({
    name: "Vortex Pair",
    kLabel: "Separation:",
    kDecimals: 1,
    kStep: 1.0,
    kDefault: (l) => Math.floor(l / 2),
  }),
  createPreset({
    name: "Skyrmion",
    kLabel: "Radius (σ):",
    kDecimals: 1,
    kStep: 1.0,
    kDefault: (l) => Math.max(2.0, l / 5.0),
  }),
  createPreset({
    name: "Single Kick",
    kLabel: "Velocity (ω):",
    kDecimals: 2,
    kStep: 0.1,
    kDefault: 5.0,
  }),
  createPreset({
    name: "Thermalized",
    kLabel: "Mean Energy (ε):",
    kDecimals: 2,
    kStep: 0.1,
    kDefault: 1.0,
    kMin: 0.0,
  }),
];

export function getPresetByName(name: string): PresetInfo {
  return PRESETS.find((p) => p.name === name) || PRESETS[0];
}

export function generateInitialState(
  l: number,
  presetName: string,
  k: number,
  p2: number,
  p3: number,
  temp: number,
): { theta: Float64Array; omega: Float64Array } {
  const n = l * l;
  const theta = new Float64Array(n);
  const omega = new Float64Array(n);

  // Helper for 2D indices
  // row=y, col=x
  const getIdx = (r: number, c: number) => r * l + c;

  if (presetName === "Random Angles") {
    for (let i = 0; i < n; i++) {
      theta[i] = Math.random() * 2 * Math.PI - Math.PI;
    }
  } else if (presetName === "Twisted") {
    // theta_ij = 2*pi*k*i/L (twist along x/col or y/row?)
    // Python: i_indices from arange(l).repeat(l)... transpose...
    // indices in python: i increases down rows?
    // i_indices = [0, 0, ..., 1, 1, ... ] (l times) if repeated correctly
    // Python: np.arange(l).repeat(l).reshape(l, l).T.flatten()
    // T makes it vary along columns?
    // np.arange(l).repeat(l).reshape(l, l) -> [[0..0], [1..1]..] (rows constant)
    // .T -> [[0, 1, ..], [0, 1, ..]] (cols constant?)
    // Let's just implement Twist along X: theta(x,y) = 2*pi*k*x/L
    for (let r = 0; r < l; r++) {
      for (let c = 0; c < l; c++) {
        theta[getIdx(r, c)] = (2 * Math.PI * k * r) / l; // Twist along rows (Y) like Python's i_indices usually
      }
    }
  } else if (presetName === "Domain Wall") {
    const half = Math.floor(l / 2);
    for (let r = 0; r < l; r++) {
      for (let c = 0; c < l; c++) {
        theta[getIdx(r, c)] = r >= half ? Math.PI : 0;
      }
    }
    // Kick first rotor slightly
    omega[0] = 1e-6;
  } else if (presetName === "Pi/2 Domain Wall") {
    const half = Math.floor(l / 2);
    for (let r = 0; r < l; r++) {
      for (let c = 0; c < l; c++) {
        theta[getIdx(r, c)] = r < half ? Math.PI / 2 : -Math.PI / 2;
      }
    }
    // Kick first rotor slightly
    omega[0] = 1e-6;
  } else if (presetName === "Vortex Band") {
    const w = Math.floor(p2);
    const deltaPhi = p3;
    const mid = Math.floor(l / 2);
    const start = Math.max(0, mid - Math.floor(w / 2));
    const end = Math.min(l, start + w);

    for (let c = start; c < end; c++) {
      for (let r = 0; r < l; r++) {
        const ramp = (2 * Math.PI * k * r) / l;
        theta[getIdx(r, c)] = ramp + (c - start) * deltaPhi;
      }
    }
  } else if (presetName === "Cross Domain") {
    for (let r = 0; r < l; r++) {
      for (let c = 0; c < l; c++) {
        // y=r, x=c
        const upper = r < c && r < l - 1 - c;
        const lower = r > c && r > l - 1 - c;
        const left = r > c && r < l - 1 - c;
        const right = r < c && r > l - 1 - c;

        let val = 0;
        if (upper || lower) val = Math.PI / 2;
        if (left || right) val = -Math.PI / 2;
        theta[getIdx(r, c)] = val;
      }
    }
  } else if (presetName === "Vortex Pair") {
    const mid = (l - 1) / 2.0;
    const sep = k / 2.0;
    for (let r = 0; r < l; r++) {
      for (let c = 0; c < l; c++) {
        // v1 at (mid - sep, mid) -- wait, x or y?
        // Python: v1 = arctan2(yy - mid, xx - (mid - sep))
        // yy is row index?
        const y = r;
        const x = c;
        const v1 = Math.atan2(y - mid, x - (mid - sep));
        const v2 = Math.atan2(y - mid, x - (mid + sep));
        theta[getIdx(r, c)] = v1 - v2;
      }
    }
  } else if (presetName === "Skyrmion") {
    const mid = (l - 1) / 2.0;
    const sigma = k;
    for (let r = 0; r < l; r++) {
      for (let c = 0; c < l; c++) {
        const rSq = (c - mid) ** 2 + (r - mid) ** 2;
        theta[getIdx(r, c)] = Math.PI * Math.exp(-rSq / (2 * sigma * sigma));
      }
    }
  } else if (presetName === "Single Kick") {
    const mid = (l - 1) / 2.0;
    const omegaPeak = k;
    const sigma = 2.0;
    for (let r = 0; r < l; r++) {
      for (let c = 0; c < l; c++) {
        const rSq = (c - mid) ** 2 + (r - mid) ** 2;
        omega[getIdx(r, c)] = omegaPeak * Math.exp(-rSq / (2 * sigma * sigma));
      }
    }
  } else if (presetName === "Thermalized") {
    const sigma = Math.sqrt(Math.max(0, 2 * k));
    for (let i = 0; i < n; i++) {
      // Box-Muller transform for Gaussian
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      omega[i] = z * sigma;
    }
  }

  // Add thermal noise overlay
  if (temp > 0) {
    const noiseSigma = Math.sqrt(2.0 * temp);
    for (let i = 0; i < n; i++) {
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      omega[i] += z * noiseSigma;
    }
  }

  // Wrap theta
  for (let i = 0; i < n; i++) {
    let th = theta[i];
    th = (th + Math.PI) % (2 * Math.PI);
    if (th < 0) th += 2 * Math.PI;
    th -= Math.PI;
    theta[i] = th;
  }

  return { theta, omega };
}

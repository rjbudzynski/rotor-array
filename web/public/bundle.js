// src/simulation.ts
var RotorArray = class {
  params;
  nRotors;
  constructor(params) {
    if (params.lSide <= 0)
      throw new Error("lSide must be positive");
    this.params = params;
    this.nRotors = params.lSide * params.lSide;
  }
  getAcceleration(theta, outAccel) {
    const L = this.params.lSide;
    const J = this.params.jCoupling;
    const M = this.params.mField;
    for (let row = 0; row < L; row++) {
      const rowOffset = row * L;
      const upRowOffset = (row - 1 + L) % L * L;
      const downRowOffset = (row + 1) % L * L;
      for (let col = 0; col < L; col++) {
        const idx = rowOffset + col;
        const theta_i = theta[idx];
        const leftIdx = rowOffset + (col - 1 + L) % L;
        const rightIdx = rowOffset + (col + 1) % L;
        const upIdx = upRowOffset + col;
        const downIdx = downRowOffset + col;
        let forceSum = 0;
        forceSum += Math.sin(theta[rightIdx] - theta_i);
        forceSum += Math.sin(theta[leftIdx] - theta_i);
        forceSum += Math.sin(theta[downIdx] - theta_i);
        forceSum += Math.sin(theta[upIdx] - theta_i);
        outAccel[idx] = J * forceSum - M * Math.sin(theta_i);
      }
    }
  }
  hamiltonian(theta, omega) {
    let kinetic = 0;
    let potential = 0;
    let field = 0;
    const L = this.params.lSide;
    const J = this.params.jCoupling;
    const M = this.params.mField;
    const N = this.nRotors;
    for (let i = 0; i < N; i++) {
      kinetic += 0.5 * omega[i] * omega[i];
      field += -M * Math.cos(theta[i]);
    }
    for (let row = 0; row < L; row++) {
      const rowOffset = row * L;
      const downRowOffset = (row + 1) % L * L;
      for (let col = 0; col < L; col++) {
        const idx = rowOffset + col;
        const rightIdx = rowOffset + (col + 1) % L;
        const downIdx = downRowOffset + col;
        const t = theta[idx];
        potential += J * (1 - Math.cos(t - theta[rightIdx]));
        potential += J * (1 - Math.cos(t - theta[downIdx]));
      }
    }
    return kinetic + potential + field;
  }
};
var SimulationEngine = class {
  params;
  array;
  theta;
  omega;
  // Acceleration buffer
  _accel;
  // Acceleration dirty flag (if parameters changed)
  _accelDirty = true;
  t = 0;
  adaptiveSubstepping = true;
  substeps = 10;
  stabilityFactor = 6e-3;
  constructor(params) {
    this.params = { ...params };
    this.array = new RotorArray(this.params);
    const N = params.lSide * params.lSide;
    this.theta = new Float64Array(N);
    this.omega = new Float64Array(N);
    this._accel = new Float64Array(N);
  }
  setState(theta, omega, t = 0) {
    if (theta.length !== this.theta.length || omega.length !== this.omega.length) {
      throw new Error("State array size mismatch");
    }
    this.theta.set(theta);
    this.omega.set(omega);
    this.t = t;
    this._accelDirty = true;
  }
  updateParams(j, m) {
    if (j !== void 0)
      this.params.jCoupling = j;
    if (m !== void 0)
      this.params.mField = m;
    this.array.params = this.params;
    this._accelDirty = true;
  }
  // Velocity Verlet
  verletStep(dt) {
    const N = this.params.lSide * this.params.lSide;
    if (this._accelDirty) {
      this.array.getAcceleration(this.theta, this._accel);
      this._accelDirty = false;
    }
    const halfDt = dt * 0.5;
    for (let i = 0; i < N; i++) {
      this.omega[i] += this._accel[i] * halfDt;
    }
    for (let i = 0; i < N; i++) {
      this.theta[i] += this.omega[i] * dt;
      let th = this.theta[i];
      if (th > Math.PI || th < -Math.PI) {
        th = (th + Math.PI) % (2 * Math.PI);
        if (th < 0)
          th += 2 * Math.PI;
        th -= Math.PI;
        this.theta[i] = th;
      }
    }
    this.array.getAcceleration(this.theta, this._accel);
    for (let i = 0; i < N; i++) {
      this.omega[i] += this._accel[i] * halfDt;
    }
    this.t += dt;
  }
  step(dt) {
    if (this.adaptiveSubstepping) {
      const J = Math.abs(this.params.jCoupling);
      const M = Math.abs(this.params.mField);
      const omegaMax = Math.sqrt(8 * J + M + 1e-9);
      this.substeps = Math.max(1, Math.ceil(dt * omegaMax / this.stabilityFactor));
    }
    const subDt = dt / this.substeps;
    for (let i = 0; i < this.substeps; i++) {
      this.verletStep(subDt);
    }
  }
  getEnergy() {
    return this.array.hamiltonian(this.theta, this.omega);
  }
  getOrderParameter() {
    const N = this.theta.length;
    let sumCos = 0;
    let sumSin = 0;
    for (let i = 0; i < N; i++) {
      sumCos += Math.cos(this.theta[i]);
      sumSin += Math.sin(this.theta[i]);
    }
    const meanCos = sumCos / N;
    const meanSin = sumSin / N;
    const r = Math.sqrt(meanCos * meanCos + meanSin * meanSin);
    return { r, meanCos, meanSin };
  }
};

// src/colors.ts
function thetaToHue(theta) {
  let h = theta % (2 * Math.PI) / (2 * Math.PI);
  if (h < 0)
    h += 1;
  return h;
}
function omegaToValue(omegaSq, valMin = 0.2, valMax = 0.8) {
  const energyFactor = Math.tanh(omegaSq / 5);
  return valMin + (valMax - valMin) * energyFactor;
}
function hsvToRgb(h, s, v, out, offset) {
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

// src/visualizer.ts
var RotorArrayVisualizer = class {
  canvas;
  ctx;
  lSide = 0;
  imageData = null;
  mask = null;
  upsample = 0;
  constructor(canvas2) {
    this.canvas = canvas2;
    const ctx = canvas2.getContext("2d", { alpha: false });
    if (!ctx)
      throw new Error("No 2D Context");
    this.ctx = ctx;
  }
  setLSide(l) {
    let width = this.canvas.clientWidth;
    let height = this.canvas.clientHeight;
    if (width === 0)
      width = 600;
    if (height === 0)
      height = 600;
    const size = Math.min(width, height);
    const newUpsample = Math.floor(size / l);
    if (this.lSide !== l || this.upsample !== newUpsample || this.canvas.width !== size) {
      this.lSide = l;
      this.upsample = newUpsample;
      const actualSize = l * newUpsample;
      this.canvas.width = actualSize;
      this.canvas.height = actualSize;
      this.updateBuffers();
    }
  }
  updateBuffers() {
    if (this.upsample <= 0)
      return;
    const size = this.lSide * this.upsample;
    this.imageData = new ImageData(size, size);
    const S = this.upsample;
    this.mask = new Uint8Array(S * S);
    const center = (S - 1) / 2;
    const radius = 0.45 * S;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dist = Math.sqrt((x - center) ** 2 + (y - center) ** 2);
        let a = 0;
        if (dist < radius - 0.5)
          a = 255;
        else if (dist < radius + 0.5)
          a = Math.floor(255 * (radius + 0.5 - dist));
        this.mask[y * S + x] = a;
      }
    }
  }
  update(theta, omega, showArrows) {
    if (!this.imageData || !this.mask || this.upsample <= 0)
      return;
    const L = this.lSide;
    const S = this.upsample;
    const data = this.imageData.data;
    const mask = this.mask;
    const totalW = L * S;
    new Uint32Array(data.buffer).fill(4278190080);
    for (let r = 0; r < L; r++) {
      for (let c = 0; c < L; c++) {
        const idx = r * L + c;
        const th = theta[idx];
        const om = omega[idx];
        const hue = thetaToHue(th);
        const val = omegaToValue(om * om);
        const h = hue;
        const v = val;
        const i = Math.floor(h * 6);
        const f = h * 6 - i;
        const q = v * (1 - f);
        const t = v * f;
        let rr = 0, gg = 0, bb = 0;
        const ii = i % 6;
        switch (ii) {
          case 0:
            rr = v;
            gg = t;
            bb = 0;
            break;
          case 1:
            rr = q;
            gg = v;
            bb = 0;
            break;
          case 2:
            rr = 0;
            gg = v;
            bb = t;
            break;
          case 3:
            rr = 0;
            gg = q;
            bb = v;
            break;
          case 4:
            rr = t;
            gg = 0;
            bb = v;
            break;
          case 5:
            rr = v;
            gg = 0;
            bb = q;
            break;
        }
        const rInt = Math.floor(rr * 255);
        const gInt = Math.floor(gg * 255);
        const bInt = Math.floor(bb * 255);
        const startY = r * S;
        const startX = c * S;
        for (let my = 0; my < S; my++) {
          const rowIdx = (startY + my) * totalW * 4;
          const mRowIdx = my * S;
          for (let mx = 0; mx < S; mx++) {
            const alpha = mask[mRowIdx + mx];
            if (alpha === 0)
              continue;
            const pIdx = rowIdx + (startX + mx) * 4;
            data[pIdx] = rInt;
            data[pIdx + 1] = gInt;
            data[pIdx + 2] = bInt;
            data[pIdx + 3] = alpha;
          }
        }
      }
    }
    this.ctx.putImageData(this.imageData, 0, 0);
    if (showArrows && L <= 60) {
      this.drawArrows(theta);
    }
  }
  drawArrows(theta) {
    const L = this.lSide;
    const S = this.upsample;
    const ctx = this.ctx;
    const centerOffset = (S - 1) / 2;
    const arrowLen = 0.45 * S;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = Math.max(1, S / 10);
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let r = 0; r < L; r++) {
      for (let c = 0; c < L; c++) {
        const idx = r * L + c;
        const th = theta[idx];
        const cx = c * S + centerOffset;
        const cy = r * S + centerOffset;
        const ex = cx + arrowLen * Math.sin(th);
        const ey = cy - arrowLen * Math.cos(th);
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
      }
    }
    ctx.stroke();
  }
};

// src/presets.ts
var DEFAULT_PRESET = {
  name: "Default",
  kLabel: "Parameter:",
  kDecimals: 2,
  kStep: 0.1,
  kMin: -1e3,
  kMax: 1e3,
  kDefault: 1,
  p2Decimals: 0,
  p2Step: 1,
  p2Min: 1,
  p2Max: 1e3,
  p2Default: 1,
  p3Decimals: 2,
  p3Step: 0.1,
  p3Min: -Math.PI,
  p3Max: Math.PI,
  p3Default: 0
};
function createPreset(base) {
  return { ...DEFAULT_PRESET, ...base };
}
var PRESETS = [
  createPreset({ name: "Random Angles" }),
  createPreset({
    name: "Twisted",
    kLabel: "Winding (k):",
    kDecimals: 0,
    kStep: 1,
    kDefault: 1
  }),
  createPreset({ name: "Domain Wall" }),
  createPreset({
    name: "Vortex Band",
    kLabel: "Wraps (k):",
    kDecimals: 0,
    kStep: 1,
    kDefault: 1,
    p2Label: "Width (w):",
    p2Default: 1,
    p3Label: "Shift (\u03B4\u03C6):",
    p3Default: 0
  }),
  createPreset({ name: "Cross Domain" }),
  createPreset({
    name: "Vortex Pair",
    kLabel: "Separation:",
    kDecimals: 1,
    kStep: 1,
    kDefault: (l) => Math.floor(l / 2)
  }),
  createPreset({
    name: "Skyrmion",
    kLabel: "Radius (\u03C3):",
    kDecimals: 1,
    kStep: 1,
    kDefault: (l) => Math.max(2, l / 5)
  }),
  createPreset({
    name: "Single Kick",
    kLabel: "Velocity (\u03C9):",
    kDecimals: 2,
    kStep: 0.1,
    kDefault: 5
  }),
  createPreset({
    name: "Thermalized",
    kLabel: "Mean Energy (\u03B5):",
    kDecimals: 2,
    kStep: 0.1,
    kDefault: 1,
    kMin: 0
  })
];
function getPresetByName(name) {
  return PRESETS.find((p) => p.name === name) || PRESETS[0];
}
function generateInitialState(l, presetName, k, p2, p3, temp) {
  const n = l * l;
  const theta = new Float64Array(n);
  const omega = new Float64Array(n);
  const getIdx = (r, c) => r * l + c;
  if (presetName === "Random Angles") {
    for (let i = 0; i < n; i++) {
      theta[i] = Math.random() * 2 * Math.PI - Math.PI;
    }
  } else if (presetName === "Twisted") {
    for (let r = 0; r < l; r++) {
      for (let c = 0; c < l; c++) {
        theta[getIdx(r, c)] = 2 * Math.PI * k * r / l;
      }
    }
  } else if (presetName === "Domain Wall") {
    const half = Math.floor(l / 2);
    for (let r = 0; r < l; r++) {
      for (let c = 0; c < l; c++) {
        theta[getIdx(r, c)] = r >= half ? Math.PI : 0;
      }
    }
    omega[0] = 1e-6;
  } else if (presetName === "Vortex Band") {
    const w = Math.floor(p2);
    const deltaPhi = p3;
    const mid = Math.floor(l / 2);
    const start = Math.max(0, mid - Math.floor(w / 2));
    const end = Math.min(l, start + w);
    for (let c = start; c < end; c++) {
      for (let r = 0; r < l; r++) {
        const ramp = 2 * Math.PI * k * r / l;
        theta[getIdx(r, c)] = ramp + (c - start) * deltaPhi;
      }
    }
  } else if (presetName === "Cross Domain") {
    for (let r = 0; r < l; r++) {
      for (let c = 0; c < l; c++) {
        const upper = r < c && r < l - 1 - c;
        const lower = r > c && r > l - 1 - c;
        const left = r > c && r < l - 1 - c;
        const right = r < c && r > l - 1 - c;
        let val = 0;
        if (upper || lower)
          val = Math.PI / 2;
        if (left || right)
          val = -Math.PI / 2;
        theta[getIdx(r, c)] = val;
      }
    }
  } else if (presetName === "Vortex Pair") {
    const mid = (l - 1) / 2;
    const sep = k / 2;
    for (let r = 0; r < l; r++) {
      for (let c = 0; c < l; c++) {
        const y = r;
        const x = c;
        const v1 = Math.atan2(y - mid, x - (mid - sep));
        const v2 = Math.atan2(y - mid, x - (mid + sep));
        theta[getIdx(r, c)] = v1 - v2;
      }
    }
  } else if (presetName === "Skyrmion") {
    const mid = (l - 1) / 2;
    const sigma = k;
    for (let r = 0; r < l; r++) {
      for (let c = 0; c < l; c++) {
        const rSq = (c - mid) ** 2 + (r - mid) ** 2;
        theta[getIdx(r, c)] = Math.PI * Math.exp(-rSq / (2 * sigma * sigma));
      }
    }
  } else if (presetName === "Single Kick") {
    const mid = (l - 1) / 2;
    const omegaPeak = k;
    const sigma = 2;
    for (let r = 0; r < l; r++) {
      for (let c = 0; c < l; c++) {
        const rSq = (c - mid) ** 2 + (r - mid) ** 2;
        omega[getIdx(r, c)] = omegaPeak * Math.exp(-rSq / (2 * sigma * sigma));
      }
    }
  } else if (presetName === "Thermalized") {
    const sigma = Math.sqrt(Math.max(0, 2 * k));
    for (let i = 0; i < n; i++) {
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      omega[i] = z * sigma;
    }
  }
  if (temp > 0) {
    const noiseSigma = Math.sqrt(2 * temp);
    for (let i = 0; i < n; i++) {
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      omega[i] += z * noiseSigma;
    }
  }
  for (let i = 0; i < n; i++) {
    let th = theta[i];
    th = (th + Math.PI) % (2 * Math.PI);
    if (th < 0)
      th += 2 * Math.PI;
    th -= Math.PI;
    theta[i] = th;
  }
  return { theta, omega };
}

// src/ui.ts
var MeanDirectionVisualizer = class {
  canvas;
  ctx;
  constructor(canvas2) {
    this.canvas = canvas2;
    const ctx = canvas2.getContext("2d", { alpha: true });
    if (!ctx)
      throw new Error("No context");
    this.ctx = ctx;
    this.renderWheel();
  }
  renderWheel() {
    const size = this.canvas.width;
    const center = size / 2;
    const radius = center * 0.9;
    const imgData = this.ctx.createImageData(size, size);
    const data = imgData.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - center;
        const dy = y - center;
        const r = Math.sqrt(dx * dx + dy * dy);
        if (r > radius)
          continue;
        const angle = Math.atan2(dy, dx);
        const mathTheta = angle + Math.PI / 2;
        const hue = thetaToHue(mathTheta);
        const pixelIdx = (y * size + x) * 4;
        hsvToRgb(hue, 1, 0.8, data, pixelIdx);
        data[pixelIdx + 3] = 255;
      }
    }
    this.ctx.putImageData(imgData, 0, 0);
  }
  update(r, meanCos, meanSin) {
    this.renderWheel();
    const size = this.canvas.width;
    const center = size / 2;
    const radius = center * 0.9;
    const vecX = meanSin;
    const vecY = -meanCos;
    this.ctx.strokeStyle = "black";
    this.ctx.lineWidth = 4;
    this.ctx.beginPath();
    this.ctx.moveTo(center, center);
    this.ctx.lineTo(center + vecX * radius, center + vecY * radius);
    this.ctx.stroke();
  }
};
var ControlPanel = class {
  container;
  // State callbacks
  onLChange;
  onReset;
  onParamChange;
  onArrowChange;
  onStartStop;
  // UI Elements
  lInput;
  presetSelect;
  kLabel;
  kInput;
  p2Container;
  p2Label;
  p2Input;
  p3Container;
  p3Label;
  p3Input;
  jInput;
  jLabel;
  mInput;
  mLabel;
  timeInput;
  timeLabel;
  tempInput;
  tempLabel;
  arrowCheck;
  startBtn;
  resetBtn;
  isRunning = false;
  constructor(containerId) {
    const el = document.getElementById(containerId);
    if (!el)
      throw new Error("Controls container not found");
    this.container = el;
    this.render();
  }
  render() {
    const group = (label, el) => {
      const div = document.createElement("div");
      div.className = "control-group";
      const lbl = document.createElement("label");
      lbl.textContent = label;
      div.appendChild(lbl);
      div.appendChild(el);
      return { div, lbl };
    };
    this.lInput = document.createElement("input");
    this.lInput.type = "number";
    this.lInput.min = "2";
    this.lInput.max = "200";
    this.lInput.value = "20";
    this.container.appendChild(group("Lattice Side (L)", this.lInput).div);
    this.presetSelect = document.createElement("select");
    PRESETS.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.name;
      opt.textContent = p.name;
      this.presetSelect.appendChild(opt);
    });
    this.container.appendChild(group("Preset", this.presetSelect).div);
    this.kInput = document.createElement("input");
    this.kInput.type = "number";
    this.kInput.step = "0.1";
    const kG = group("Parameter K", this.kInput);
    this.kLabel = kG.lbl;
    this.container.appendChild(kG.div);
    this.p2Input = document.createElement("input");
    this.p2Input.type = "number";
    const p2G = group("Parameter 2", this.p2Input);
    this.p2Label = p2G.lbl;
    this.p2Container = p2G.div;
    this.container.appendChild(this.p2Container);
    this.p3Input = document.createElement("input");
    this.p3Input.type = "number";
    const p3G = group("Parameter 3", this.p3Input);
    this.p3Label = p3G.lbl;
    this.p3Container = p3G.div;
    this.container.appendChild(this.p3Container);
    this.jInput = document.createElement("input");
    this.jInput.type = "range";
    this.jInput.min = "0";
    this.jInput.max = "500";
    this.jInput.value = "100";
    const jG = group("Coupling (J): 1.00", this.jInput);
    this.jLabel = jG.lbl;
    this.container.appendChild(jG.div);
    this.mInput = document.createElement("input");
    this.mInput.type = "range";
    this.mInput.min = "0";
    this.mInput.max = "1000";
    this.mInput.value = "0";
    const mG = group("Field (M): 0.00", this.mInput);
    this.mLabel = mG.lbl;
    this.container.appendChild(mG.div);
    this.timeInput = document.createElement("input");
    this.timeInput.type = "range";
    this.timeInput.min = "10";
    this.timeInput.max = "500";
    this.timeInput.value = "100";
    const timeG = group("Time Scale: 1.0x", this.timeInput);
    this.timeLabel = timeG.lbl;
    this.container.appendChild(timeG.div);
    this.tempInput = document.createElement("input");
    this.tempInput.type = "range";
    this.tempInput.min = "0";
    this.tempInput.max = "200";
    this.tempInput.value = "0";
    const tempG = group("Initial Temp (T): 0.00", this.tempInput);
    this.tempLabel = tempG.lbl;
    this.container.appendChild(tempG.div);
    const arrowDiv = document.createElement("div");
    arrowDiv.className = "control-group row";
    const aLbl = document.createElement("label");
    aLbl.textContent = "Show Arrows";
    aLbl.style.marginBottom = "0";
    this.arrowCheck = document.createElement("input");
    this.arrowCheck.type = "checkbox";
    arrowDiv.appendChild(aLbl);
    arrowDiv.appendChild(this.arrowCheck);
    this.container.appendChild(arrowDiv);
    const btnRow = document.createElement("div");
    btnRow.className = "row";
    btnRow.style.marginTop = "10px";
    this.startBtn = document.createElement("button");
    this.startBtn.textContent = "Start";
    this.resetBtn = document.createElement("button");
    this.resetBtn.textContent = "Reset";
    btnRow.appendChild(this.startBtn);
    btnRow.appendChild(this.resetBtn);
    this.container.appendChild(btnRow);
    this.presetSelect.addEventListener("change", () => this.updatePresetUI());
    this.lInput.addEventListener("change", () => this.updatePresetUI());
    this.jInput.addEventListener("input", () => {
      const val = parseFloat(this.jInput.value) / 100;
      this.jLabel.textContent = `Coupling (J): ${val.toFixed(2)}`;
      this.emitParamChange();
    });
    this.mInput.addEventListener("input", () => {
      const val = parseFloat(this.mInput.value) / 100;
      this.mLabel.textContent = `Field (M): ${val.toFixed(2)}`;
      this.emitParamChange();
    });
    this.timeInput.addEventListener("input", () => {
      const val = parseFloat(this.timeInput.value) / 100;
      this.timeLabel.textContent = `Time Scale: ${val.toFixed(1)}x`;
      this.emitParamChange();
    });
    this.tempInput.addEventListener("input", () => {
      const val = parseFloat(this.tempInput.value) / 100;
      this.tempLabel.textContent = `Initial Temp (T): ${val.toFixed(2)}`;
    });
    this.arrowCheck.addEventListener("change", () => {
      if (this.onArrowChange)
        this.onArrowChange(this.arrowCheck.checked);
    });
    this.startBtn.addEventListener("click", () => {
      this.isRunning = !this.isRunning;
      this.startBtn.textContent = this.isRunning ? "Stop" : "Start";
      this.startBtn.classList.toggle("active", this.isRunning);
      this.toggleInputs(!this.isRunning);
      if (this.onStartStop)
        this.onStartStop(this.isRunning);
    });
    this.resetBtn.addEventListener("click", () => {
      this.triggerReset();
    });
    this.updatePresetUI();
  }
  updatePresetUI() {
    const name = this.presetSelect.value;
    const p = getPresetByName(name);
    const l = parseInt(this.lInput.value) || 20;
    const showK = name !== "Random Angles" && name !== "Domain Wall" && name !== "Cross Domain";
    this.kLabel.parentElement.style.display = showK ? "block" : "none";
    this.kLabel.textContent = p.kLabel || "Parameter:";
    this.kInput.step = p.kStep.toString();
    if (p.p2Label) {
      this.p2Container.style.display = "block";
      this.p2Label.textContent = p.p2Label;
      this.p2Input.step = p.p2Step.toString();
    } else {
      this.p2Container.style.display = "none";
    }
    if (p.p3Label) {
      this.p3Container.style.display = "block";
      this.p3Label.textContent = p.p3Label;
      this.p3Input.step = p.p3Step.toString();
    } else {
      this.p3Container.style.display = "none";
    }
    this.loadPresetDefaults();
  }
  loadPresetDefaults() {
    const name = this.presetSelect.value;
    const p = getPresetByName(name);
    const l = parseInt(this.lInput.value) || 20;
    const kVal = typeof p.kDefault === "function" ? p.kDefault(l) : p.kDefault;
    this.kInput.value = kVal.toString();
    if (p.p2Label) {
      const p2Val = typeof p.p2Default === "function" ? p.p2Default(l) : p.p2Default;
      this.p2Input.value = p2Val.toString();
    }
    if (p.p3Label) {
      const p3Val = typeof p.p3Default === "function" ? p.p3Default(l) : p.p3Default;
      this.p3Input.value = p3Val.toString();
    }
  }
  toggleInputs(enable) {
    this.lInput.disabled = !enable;
    this.presetSelect.disabled = !enable;
    this.kInput.disabled = !enable;
    this.p2Input.disabled = !enable;
    this.p3Input.disabled = !enable;
    this.tempInput.disabled = !enable;
    this.resetBtn.disabled = !enable;
  }
  emitParamChange() {
    if (this.onParamChange) {
      const j = parseFloat(this.jInput.value) / 100;
      const m = parseFloat(this.mInput.value) / 100;
      const t = parseFloat(this.timeInput.value) / 100;
      this.onParamChange(j, m, t);
    }
  }
  triggerReset() {
    if (this.onReset) {
      const name = this.presetSelect.value;
      const l = parseInt(this.lInput.value);
      const k = parseFloat(this.kInput.value);
      const p2 = parseFloat(this.p2Input.value);
      const p3 = parseFloat(this.p3Input.value);
      const temp = parseFloat(this.tempInput.value) / 100;
      this.onReset(name, k, p2, p3, temp);
    }
  }
};
var OrderPlot = class {
  uplot;
  data;
  constructor(containerId) {
    const el = document.getElementById(containerId);
    this.data = [[], []];
    const opts = {
      width: el?.clientWidth || 300,
      height: 150,
      series: [
        {},
        {
          stroke: "yellow",
          width: 2,
          label: "Order Parameter (r)",
          value: (u, v) => v == null ? "-" : v.toFixed(3)
        }
      ],
      scales: {
        x: { time: false },
        y: { range: [0, 1.1] }
      },
      axes: [
        { stroke: "#ccc", grid: { stroke: "#333" } },
        { stroke: "#ccc", grid: { stroke: "#333" } }
      ]
    };
    this.uplot = new uPlot(opts, this.data, el);
  }
  push(t, r) {
    this.data[0].push(t);
    this.data[1].push(r);
    if (this.data[0].length > 500) {
      this.data[0].shift();
      this.data[1].shift();
    }
    this.uplot.setData(this.data);
  }
  reset() {
    this.data = [[], []];
    this.uplot.setData(this.data);
  }
};

// src/main.ts
var canvas = document.getElementById("sim-canvas");
var mdCanvas = document.getElementById("mean-dir-canvas");
var visualizer = new RotorArrayVisualizer(canvas);
var mdViz = new MeanDirectionVisualizer(mdCanvas);
var plot = new OrderPlot("uplot-chart");
var controls = new ControlPanel("controls-container");
var engine = null;
var running = false;
var timeScale = 1;
var lastFrame = 0;
var loop = (timestamp) => {
  const dt = (timestamp - lastFrame) / 1e3;
  lastFrame = timestamp;
  const safeDt = Math.min(dt, 0.1);
  if (engine) {
    if (running) {
      engine.step(safeDt * timeScale);
      const op = engine.getOrderParameter();
      plot.push(engine.t, op.r);
      mdViz.update(op.r, op.meanCos, op.meanSin);
    }
    visualizer.setLSide(engine.params.lSide);
    visualizer.update(engine.theta, engine.omega, controls.arrowCheck.checked);
  }
  requestAnimationFrame(loop);
};
controls.onReset = (preset, k, p2, p3, temp) => {
  const l = parseInt(controls.lInput.value) || 20;
  const params = {
    lSide: l,
    jCoupling: parseFloat(controls.jInput.value) / 100,
    mField: parseFloat(controls.mInput.value) / 100
  };
  engine = new SimulationEngine(params);
  const { theta, omega } = generateInitialState(l, preset, k, p2, p3, temp);
  engine.setState(theta, omega);
  timeScale = parseFloat(controls.timeInput.value) / 100;
  plot.reset();
  running = false;
  controls.isRunning = false;
  controls.startBtn.textContent = "Start";
  controls.startBtn.classList.remove("active");
  controls.toggleInputs(true);
};
controls.onParamChange = (j, m, t) => {
  timeScale = t;
  if (engine) {
    engine.updateParams(j, m);
  }
};
controls.onStartStop = (r) => {
  running = r;
};
requestAnimationFrame(loop);
setTimeout(() => {
  controls.triggerReset();
}, 100);
//# sourceMappingURL=bundle.js.map

import { getPresetByName, PRESETS } from "./presets.ts";
import { hsvToRgb, omegaToValue, thetaToHue } from "./colors.ts";
import uPlot from "uplot";

export class MeanDirectionVisualizer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  private wheelCanvas: HTMLCanvasElement | null = null;
  private wheelSize: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("No context");
    this.ctx = ctx;
    this.ensureWheel();
  }

  ensureWheel() {
    const size = this.canvas.width;
    if (this.wheelCanvas && this.wheelSize === size) return;
    this.wheelSize = size;
    this.wheelCanvas = document.createElement("canvas");
    this.wheelCanvas.width = size;
    this.wheelCanvas.height = size;
    const wheelCtx = this.wheelCanvas.getContext("2d", { alpha: true });
    if (!wheelCtx) return;
    const center = size / 2;
    const radius = center * 0.9;

    const imgData = wheelCtx.createImageData(size, size);
    const data = imgData.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - center;
        const dy = y - center;
        const r = Math.sqrt(dx * dx + dy * dy);

        if (r > radius) continue;

        const mathTheta = Math.atan2(dx, dy);
        const hue = thetaToHue(mathTheta);

        // Color
        const pixelIdx = (y * size + x) * 4;
        // HSV(hue, 1, 0.8)
        hsvToRgb(hue, 1.0, 0.8, data, pixelIdx);
        data[pixelIdx + 3] = 255;
      }
    }

    wheelCtx.putImageData(imgData, 0, 0);
  }

  update(_r: number, meanCos: number, meanSin: number) {
    this.ensureWheel();
    if (this.wheelCanvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(this.wheelCanvas, 0, 0);
    }

    const size = this.canvas.width;
    const center = size / 2;
    const radius = center * 0.9;

    const vecX = meanSin;
    const vecY = meanCos;

    // Draw line from center to center + vec * radius
    this.ctx.strokeStyle = "black";
    this.ctx.lineWidth = 4;
    this.ctx.beginPath();
    this.ctx.moveTo(center, center);
    this.ctx.lineTo(center + vecX * radius, center + vecY * radius);
    this.ctx.stroke();
  }
}

export class ControlPanel {
  container!: HTMLElement;

  // State callbacks
  onLChange?: (l: number) => void;
  onReset?: (
    preset: string,
    k: number,
    p2: number,
    p3: number,
    temp: number,
  ) => void;
  onParamChange?: (j: number, m: number, timeScale: number) => void;
  onArrowChange?: (show: boolean) => void;
  onStartStop?: (running: boolean) => void;

  // UI Elements
  lInput!: HTMLInputElement;
  presetSelect!: HTMLSelectElement;

  kLabel!: HTMLLabelElement;
  kInput!: HTMLInputElement;
  p2Container!: HTMLElement;
  p2Label!: HTMLLabelElement;
  p2Input!: HTMLInputElement;
  p3Container!: HTMLElement;
  p3Label!: HTMLLabelElement;
  p3Input!: HTMLInputElement;

  jInput!: HTMLInputElement;
  jLabel!: HTMLLabelElement;
  mInput!: HTMLInputElement;
  mLabel!: HTMLLabelElement;
  timeInput!: HTMLInputElement;
  timeLabel!: HTMLLabelElement;
  tempInput!: HTMLInputElement;
  tempLabel!: HTMLLabelElement;

  arrowCheck!: HTMLInputElement;
  startBtn!: HTMLButtonElement;
  resetBtn!: HTMLButtonElement;

  isRunning: boolean = false;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error("Controls container not found");
    this.container = el;

    this.render();
  }

  render() {
    // Helper to create input group
    const group = (label: string, el: HTMLElement) => {
      const div = document.createElement("div");
      div.className = "control-group";
      const lbl = document.createElement("label");
      lbl.textContent = label;
      div.appendChild(lbl);
      div.appendChild(el);
      return { div, lbl };
    };

    // L
    this.lInput = document.createElement("input");
    this.lInput.type = "number";
    this.lInput.min = "2";
    this.lInput.max = "500";
    this.lInput.value = "20";
    this.container.appendChild(group("Lattice Side (L)", this.lInput).div);

    // Preset
    this.presetSelect = document.createElement("select");
    PRESETS.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.name;
      opt.textContent = p.name;
      this.presetSelect.appendChild(opt);
    });
    this.container.appendChild(group("Preset", this.presetSelect).div);

    // K Param
    this.kInput = document.createElement("input");
    this.kInput.type = "number";
    this.kInput.step = "0.1";
    const kG = group("Parameter K", this.kInput);
    this.kLabel = kG.lbl;
    this.container.appendChild(kG.div);

    // P2 Param
    this.p2Input = document.createElement("input");
    this.p2Input.type = "number";
    const p2G = group("Parameter 2", this.p2Input);
    this.p2Label = p2G.lbl;
    this.p2Container = p2G.div;
    this.container.appendChild(this.p2Container);

    // P3 Param
    this.p3Input = document.createElement("input");
    this.p3Input.type = "number";
    const p3G = group("Parameter 3", this.p3Input);
    this.p3Label = p3G.lbl;
    this.p3Container = p3G.div;
    this.container.appendChild(this.p3Container);

    // J
    this.jInput = document.createElement("input");
    this.jInput.type = "range";
    this.jInput.min = "0";
    this.jInput.max = "1000";
    this.jInput.value = "100"; // 1.0
    const jG = group("Coupling (J): 1.00", this.jInput);
    this.jLabel = jG.lbl;
    this.container.appendChild(jG.div);

    // M
    this.mInput = document.createElement("input");
    this.mInput.type = "range";
    this.mInput.min = "0";
    this.mInput.max = "1000";
    this.mInput.value = "0";
    const mG = group("Field (M): 0.00", this.mInput);
    this.mLabel = mG.lbl;
    this.container.appendChild(mG.div);

    // Time Scale
    this.timeInput = document.createElement("input");
    this.timeInput.type = "range";
    this.timeInput.min = "10";
    this.timeInput.max = "500";
    this.timeInput.value = "100"; // 1.0
    const timeG = group("Time Scale: 1.0x", this.timeInput);
    this.timeLabel = timeG.lbl;
    this.container.appendChild(timeG.div);

    // Temp
    this.tempInput = document.createElement("input");
    this.tempInput.type = "range";
    this.tempInput.min = "0";
    this.tempInput.max = "200";
    this.tempInput.value = "0";
    const tempG = group("Initial Temp (T): 0.00", this.tempInput);
    this.tempLabel = tempG.lbl;
    this.container.appendChild(tempG.div);

    // Arrows
    const arrowDiv = document.createElement("div");
    arrowDiv.className = "control-group row";
    const aLbl = document.createElement("label");
    aLbl.textContent = "Show Arrows";
    if (aLbl.style) aLbl.style.marginBottom = "0";
    this.arrowCheck = document.createElement("input");
    this.arrowCheck.type = "checkbox";
    arrowDiv.appendChild(aLbl);
    arrowDiv.appendChild(this.arrowCheck);
    this.container.appendChild(arrowDiv);

    // Buttons
    const btnRow = document.createElement("div");
    btnRow.className = "row";
    if (btnRow.style) btnRow.style.marginTop = "10px";
    this.startBtn = document.createElement("button");
    this.startBtn.textContent = "Start";
    this.resetBtn = document.createElement("button");
    this.resetBtn.textContent = "Apply";
    btnRow.appendChild(this.startBtn);
    btnRow.appendChild(this.resetBtn);
    this.container.appendChild(btnRow);

    // Bind events
    this.presetSelect.addEventListener("change", () => this.updatePresetUI());
    this.lInput.addEventListener("change", () => this.updatePresetUI()); // Defaults might depend on L

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
      if (this.onArrowChange) this.onArrowChange(this.arrowCheck.checked);
    });

    this.startBtn.addEventListener("click", () => {
      this.toggleRunning();
    });

    this.resetBtn.addEventListener("click", () => {
      this.triggerReset();
    });

    // Initialize
    this.updatePresetUI();
  }

  updatePresetUI() {
    const name = this.presetSelect.value;
    const p = getPresetByName(name);
    // Update labels and visibility
    const showK = name !== "Random Angles" && name !== "Domain Wall" &&
      name !== "Cross Domain";
    if (this.kLabel.parentElement?.style) {
      this.kLabel.parentElement.style.display = showK ? "block" : "none";
    }
    this.kLabel.textContent = p.kLabel || "Parameter:";
    this.kInput.step = p.kStep.toString();
    // Set default if not set? Or keep current if reasonable?
    // Better to set default when preset changes.
    // But change event fires on user interaction.
    // We'll reset values on preset change.

    // To avoid resetting when L changes (unless necessary), we track current preset.
    // For simplicity, just update constraints.

    // P2
    if (p.p2Label) {
      if (this.p2Container.style) this.p2Container.style.display = "block";
      this.p2Label.textContent = p.p2Label;
      this.p2Input.step = p.p2Step.toString();
    } else {
      if (this.p2Container.style) this.p2Container.style.display = "none";
    }

    // P3
    if (p.p3Label) {
      if (this.p3Container.style) this.p3Container.style.display = "block";
      this.p3Label.textContent = p.p3Label;
      this.p3Input.step = p.p3Step.toString();
    } else {
      if (this.p3Container.style) this.p3Container.style.display = "none";
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
      const p2Val = typeof p.p2Default === "function"
        ? p.p2Default(l)
        : p.p2Default;
      this.p2Input.value = p2Val.toString();
    }

    if (p.p3Label) {
      const p3Val = typeof p.p3Default === "function"
        ? p.p3Default(l)
        : p.p3Default;
      this.p3Input.value = p3Val.toString();
    }
  }

  toggleInputs(enable: boolean) {
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

  toggleRunning() {
    this.isRunning = !this.isRunning;
    this.startBtn.textContent = this.isRunning ? "Stop" : "Start";
    this.startBtn.classList.toggle("active", this.isRunning);
    this.toggleInputs(!this.isRunning);
    if (this.onStartStop) this.onStartStop(this.isRunning);
  }

  triggerReset() {
    if (this.onReset) {
      const name = this.presetSelect.value;
      const k = parseFloat(this.kInput.value);
      const p2 = parseFloat(this.p2Input.value);
      const p3 = parseFloat(this.p3Input.value);
      const temp = parseFloat(this.tempInput.value) / 100;
      this.onReset(name, k, p2, p3, temp);
    }
  }
}

export class OrderPlot {
  uplot: { setData: (data: [number[], number[]]) => void };
  data: [number[], number[]];
  private maxPoints = 500;
  private bufferX: number[];
  private bufferY: number[];
  private start = 0;
  private count = 0;

  constructor(
    containerId: string,
    uplotCtor: new (
      opts: unknown,
      data: [number[], number[]],
      el: HTMLElement,
    ) => { setData: (data: [number[], number[]]) => void } =
      uPlot as unknown as new (
        opts: unknown,
        data: [number[], number[]],
        el: HTMLElement,
      ) => { setData: (data: [number[], number[]]) => void },
  ) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error("Plot container not found");
    this.data = [[], []]; // time, r
    this.bufferX = new Array(this.maxPoints);
    this.bufferY = new Array(this.maxPoints);

    const opts = {
      width: el?.clientWidth || 300,
      height: 150,
      cursor: { show: false },
      legend: { show: false },
      padding: [8, 12, 12, 2],
      series: [
        {},
        {
          stroke: "yellow",
          width: 2,
          label: "Order Parameter (r)",
        },
      ],
      scales: {
        x: { time: false },
        y: { range: [0, 1.1] },
      },
      axes: [
        { stroke: "#ccc", grid: { stroke: "#333" }, size: 25 },
        { stroke: "#ccc", grid: { stroke: "#333" }, size: 30 },
      ],
    };

    this.uplot = new uplotCtor(opts, this.data, el);
  }

  push(t: number, r: number) {
    const idx = (this.start + this.count) % this.maxPoints;
    this.bufferX[idx] = t;
    this.bufferY[idx] = r;
    if (this.count < this.maxPoints) {
      this.count += 1;
    } else {
      this.start = (this.start + 1) % this.maxPoints;
    }

    const xs: number[] = new Array(this.count);
    const ys: number[] = new Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const bIdx = (this.start + i) % this.maxPoints;
      xs[i] = this.bufferX[bIdx];
      ys[i] = this.bufferY[bIdx];
    }

    this.data = [xs, ys];
    this.uplot.setData(this.data);
  }

  reset() {
    this.data = [[], []];
    this.start = 0;
    this.count = 0;
    this.uplot.setData(this.data);
  }
}

export class ColorBarVisualizer {
  container?: HTMLElement;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) return;
    this.container = el;
    this.render();
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = `
            <div style="font-size: 10px; color: #aaa; margin-bottom: 2px;">Angle (0 → 2π)</div>
            <div id="angle-bar" style="height: 12px; width: 100%; margin-bottom: 8px; border-radius: 2px;"></div>
            <div style="font-size: 10px; color: #aaa; margin-bottom: 2px;">Energy (Dark → Bright)</div>
            <div id="energy-bar" style="height: 12px; width: 100%; border-radius: 2px;"></div>
        `;

    const angleBar = this.container.querySelector("#angle-bar") as HTMLElement;
    const energyBar = this.container.querySelector(
      "#energy-bar",
    ) as HTMLElement;

    // Angle gradient
    let angleGrad = "linear-gradient(to right";
    for (let i = 0; i <= 10; i++) {
      const theta = (i / 10) * 2 * Math.PI;
      const h = thetaToHue(theta);
      const rgb = new Uint8ClampedArray(3);
      hsvToRgb(h, 1.0, 0.8, rgb, 0);
      angleGrad += `, rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    }
    angleGrad += ")";
    if (angleBar.style) angleBar.style.background = angleGrad;

    // Energy gradient
    let energyGrad = "linear-gradient(to right";
    for (let i = 0; i <= 10; i++) {
      const e = i / 2; // Map 0..5
      const v = omegaToValue(e);
      // Use red as base
      const rgb = new Uint8ClampedArray(3);
      hsvToRgb(0, 1.0, v, rgb, 0);
      energyGrad += `, rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    }
    energyGrad += ")";
    if (energyBar.style) energyBar.style.background = energyGrad;
  }
}

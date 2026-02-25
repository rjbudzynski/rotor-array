import { getPresetByName, PRESETS } from "./presets.ts";
import { hsvToRgb, omegaToValue, thetaToHue } from "./colors.ts";
import uPlot from "uplot";
import {
  COMPACTION_WASTE_THRESHOLD,
  MAX_DEAD_ELEMENTS,
  PLOT_WINDOW_SECONDS,
} from "./constants.ts";

export class MeanDirectionVisualizer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  private wheelCanvas: HTMLCanvasElement | null = null;
  private wheelSize: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // Ensure canvas has dimensions before getting context
    if (canvas.width === 0 || canvas.height === 0) {
      canvas.width = 240;
      canvas.height = 240;
    }
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

  update(r: number, meanCos: number, meanSin: number) {
    this.ensureWheel();
    if (this.wheelCanvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(this.wheelCanvas, 0, 0);
    }

    const size = this.canvas.width;
    const center = size / 2;
    const maxRadius = center * 0.9;

    const angle = Math.atan2(meanSin, meanCos);
    const _arrowLen = r * maxRadius;

    this.ctx.save();
    this.ctx.translate(center, center);
    this.ctx.rotate(-angle);
    this.ctx.scale(maxRadius, maxRadius); // Use maxRadius as the unit scale

    this.ctx.fillStyle = "white";
    this.ctx.strokeStyle = "black";
    this.ctx.lineWidth = 1.5 / maxRadius; // Maintain thin line after scaling

    // Proportions: Shaft 2/3, Head 1/3 of total length r
    const totalLen = r;
    const headLen = totalLen * 0.33;
    const shaftLen = totalLen - headLen;
    const shaftWidth = 0.06;
    const headWidth = 0.24;

    // Draw shaft starting from center (0,0)
    this.ctx.beginPath();
    this.ctx.rect(-shaftWidth / 2, 0, shaftWidth, shaftLen);
    this.ctx.fill();
    this.ctx.stroke();

    // Draw head ending at r
    this.ctx.beginPath();
    this.ctx.moveTo(-headWidth / 2, shaftLen);
    this.ctx.lineTo(headWidth / 2, shaftLen);
    this.ctx.lineTo(0, totalLen);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();

    this.ctx.restore();
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
  private currentPreset: string = "";

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
    this.jInput.max = "20";
    this.jInput.step = "0.01";
    this.jInput.value = "1.00";
    const jG = group("Coupling (J): 1.00", this.jInput);
    this.jLabel = jG.lbl;
    this.container.appendChild(jG.div);

    // M
    this.mInput = document.createElement("input");
    this.mInput.type = "range";
    this.mInput.min = "0";
    this.mInput.max = "10";
    this.mInput.step = "0.01";
    this.mInput.value = "0.00";
    const mG = group("Field (M): 0.00", this.mInput);
    this.mLabel = mG.lbl;
    this.container.appendChild(mG.div);

    // Time Scale
    this.timeInput = document.createElement("input");
    this.timeInput.type = "range";
    this.timeInput.min = "0.1";
    this.timeInput.max = "5";
    this.timeInput.step = "0.1";
    this.timeInput.value = "1.0";
    const timeG = group("Time Scale: 1.0x", this.timeInput);
    this.timeLabel = timeG.lbl;
    this.container.appendChild(timeG.div);

    // Temp
    this.tempInput = document.createElement("input");
    this.tempInput.type = "range";
    this.tempInput.min = "0";
    this.tempInput.max = "2";
    this.tempInput.step = "0.01";
    this.tempInput.value = "0.00";
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
      const val = parseFloat(this.jInput.value);
      this.jLabel.textContent = `Coupling (J): ${val.toFixed(2)}`;
      this.emitParamChange();
    });

    this.mInput.addEventListener("input", () => {
      const val = parseFloat(this.mInput.value);
      this.mLabel.textContent = `Field (M): ${val.toFixed(2)}`;
      this.emitParamChange();
    });

    this.timeInput.addEventListener("input", () => {
      const val = parseFloat(this.timeInput.value);
      this.timeLabel.textContent = `Time Scale: ${val.toFixed(1)}x`;
      this.emitParamChange();
    });

    this.tempInput.addEventListener("input", () => {
      const val = parseFloat(this.tempInput.value);
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

  updatePresetUI(skipDefaults: boolean = false) {
    const name = this.presetSelect.value;
    const p = getPresetByName(name);
    // Update labels and visibility
    const showK = name !== "Random Angles" && name !== "Domain Wall" &&
      name !== "Pi/2 Domain Wall" &&
      name !== "Cross Domain";
    if (this.kLabel.parentElement?.style) {
      this.kLabel.parentElement.style.display = showK ? "block" : "none";
    }
    this.kLabel.textContent = p.kLabel || "Parameter:";
    this.kInput.step = p.kStep.toString();

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

    // Only load defaults if not skipped AND the preset itself changed.
    if (!skipDefaults && name !== this.currentPreset) {
      this.loadPresetDefaults();
    }
    this.currentPreset = name;
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
      const j = parseFloat(this.jInput.value);
      const m = parseFloat(this.mInput.value);
      const t = parseFloat(this.timeInput.value);
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
      const temp = parseFloat(this.tempInput.value);
      this.onReset(name, k, p2, p3, temp);
    }
  }
}

export class OrderPlot {
  uplot: {
    setData: (data: [number[], (number | null)[], (number | null)[]]) => void;
    setScale: (key: string, opts: { min: number; max: number }) => void;
    setSize: (size: { width: number; height: number }) => void;
  };
  data: [number[], (number | null)[], (number | null)[]];
  private windowSeconds = PLOT_WINDOW_SECONDS;
  private startIdx = 0; // Tracks first valid element (avoids O(n²) shift)

  constructor(
    containerId: string,
    uplotCtor: new (
      opts: unknown,
      data: [number[], (number | null)[], (number | null)[]],
      el: HTMLElement,
    ) => {
      setData: (data: [number[], (number | null)[], (number | null)[]]) => void;
      setScale: (key: string, opts: { min: number; max: number }) => void;
      setSize: (size: { width: number; height: number }) => void;
    } = uPlot as // deno-lint-ignore no-explicit-any
    any,
  ) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error("Plot container not found");
    
    // Create header for labels
    const header = document.createElement("div");
    header.className = "plot-header";
    header.innerHTML = `
      <span class="plot-label" style="color: yellow; float: left;">Order Parameter (r)</span>
      <span class="plot-label" style="color: #00f2ff; float: right;">Mean Kinetic Energy</span>
      <div style="clear: both;"></div>
    `;
    // Insert before the chart element or as first child if empty
    if (el.firstChild) {
      el.insertBefore(header, el.firstChild);
    } else {
      el.appendChild(header);
    }

    const chartDiv = document.createElement("div");
    chartDiv.id = "uplot-internal";
    el.appendChild(chartDiv);

    this.data = [[], [], []]; // time, r, mke

    const opts = {
      width: el.clientWidth,
      height: (el.clientHeight || 150) - 20, // Subtract header height
      cursor: { show: false },
      legend: { show: false },
      padding: [8, 4, 12, 2],
      series: [
        {},
        {
          stroke: "yellow",
          width: 2,
          label: "Order Parameter (r)",
          scale: "y",
        },
        {
          stroke: "#00f2ff",
          width: 2,
          label: "Mean Kinetic Energy",
          scale: "mke",
        },
      ],
      scales: {
        x: { time: false },
        y: { range: [0, 1.1] },
        mke: {
          auto: true,
          range: (_self: unknown, _min: number, max: number) => [
            0,
            Math.max(0.1, max * 1.1),
          ],
        },
      },
      axes: [
        { stroke: "#ccc", grid: { stroke: "#333" }, size: 25 },
        { stroke: "yellow", grid: { stroke: "#333" }, size: 30 },
        {
          stroke: "#00f2ff",
          grid: { show: false },
          side: 1, // Right side
          size: 40,
          scale: "mke",
        },
      ],
    };

    this.uplot = new uplotCtor(opts, this.data, chartDiv);

    // Watch for size changes
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          this.uplot.setSize({ width, height: height - 20 });
        }
      }
    });
    observer.observe(el);
  }

  push(t: number, r: number, mke: number) {
    this.data[0].push(t);
    this.data[1].push(r);
    this.data[2].push(mke);

    // Prune data older than windowSeconds (O(n) using index tracking)
    const cutoff = t - this.windowSeconds;
    const times = this.data[0];
    // Advance startIdx past expired elements
    while (this.startIdx < times.length && times[this.startIdx] < cutoff) {
      this.startIdx++;
    }

    // Compact arrays when too much dead space accumulates
    if (
      this.startIdx > MAX_DEAD_ELEMENTS ||
      this.startIdx > times.length * COMPACTION_WASTE_THRESHOLD
    ) {
      this.data[0].splice(0, this.startIdx);
      this.data[1].splice(0, this.startIdx);
      this.data[2].splice(0, this.startIdx);
      this.startIdx = 0;
    }

    // Pass full arrays to uPlot and rely on scale to window view
    this.uplot.setData(this.data);

    // Sliding window logic: [0, windowSeconds] or [t-windowSeconds, t]
    if (t > this.windowSeconds) {
      this.uplot.setScale("x", { min: t - this.windowSeconds, max: t });
    } else {
      this.uplot.setScale("x", { min: 0, max: this.windowSeconds });
    }
  }

  reset() {
    this.data = [[], [], []];
    this.startIdx = 0;
    this.uplot.setData(this.data);
    this.uplot.setScale("x", { min: 0, max: this.windowSeconds });
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

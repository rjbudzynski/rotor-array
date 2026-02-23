import {
  ColorBarVisualizer,
  ControlPanel,
  MeanDirectionVisualizer,
  OrderPlot,
} from "./ui.ts";
import { generateInitialState } from "./presets.ts";
import {
  CANVAS_PADDING,
  DEFAULT_LATTICE_SIZE,
  UI_UPDATE_INTERVAL_MS,
} from "./constants.ts";
import { FramePayload, SimulationManager } from "./simulation_manager.ts";
import {
  getStoredBoolean,
  getStoredNumberWithLegacyScaling,
  getStoredString,
} from "./persistence.ts";

const STORAGE_KEY = "rotorArrayParams";

class App {
  private canvas = document.getElementById("sim-canvas") as HTMLCanvasElement;
  private overlayCanvas = document.getElementById(
    "overlay-canvas",
  ) as HTMLCanvasElement;
  private mdCanvas = document.getElementById(
    "mean-dir-canvas",
  ) as HTMLCanvasElement;

  private simManager: SimulationManager;

  private mdViz: MeanDirectionVisualizer;
  private plot: OrderPlot;
  private controls: ControlPanel;

  private bitmapCtx: ImageBitmapRenderingContext | null;
  private ctx2d: CanvasRenderingContext2D | null;
  private overlayCtx: CanvasRenderingContext2D;

  private energyPerNodeEl = document.getElementById("energy-per-node-value");
  private energyRelDevEl = document.getElementById("energy-rel-dev-value");

  private lastUiUpdate = 0;
  private displaySize = 0;

  constructor() {
    this.simManager = new SimulationManager();

    this.bitmapCtx = this.canvas.getContext("bitmaprenderer");
    this.ctx2d = this.bitmapCtx ? null : this.canvas.getContext("2d");

    const overlayCtx = this.overlayCanvas.getContext("2d");
    if (!overlayCtx) throw new Error("Failed to get overlay canvas context");
    this.overlayCtx = overlayCtx;

    this.mdViz = new MeanDirectionVisualizer(this.mdCanvas);
    this.plot = new OrderPlot("uplot-chart");
    this.controls = new ControlPanel("controls-container");
    new ColorBarVisualizer("color-bar-container");

    this.setupListeners();
    this.setupResizeObserver();
    this.init();
  }

  private setupResizeObserver() {
    const container = document.getElementById("canvas-container");
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const size = Math.max(100, Math.min(width, height));

        if (size !== this.displaySize) {
          this.displaySize = size;
          const stack = document.getElementById("canvas-stack");
          if (stack) {
            stack.style.width = `${size}px`;
            stack.style.height = `${size}px`;
          }

          // Trigger a re-calculation of upsample without full reset
          const lSide = parseInt(this.controls.lInput.value) ||
            DEFAULT_LATTICE_SIZE;
          const upsample = Math.max(1, Math.floor(this.displaySize / lSide));
          this.simManager.updateUpsample(upsample);
        }
      }
    });
    observer.observe(container);
  }

  private init() {
    this.loadParameters();
    this.simManager.init();

    setTimeout(() => {
      this.controls.triggerReset();
    }, 200);
  }

  private setupListeners() {
    this.simManager.onFrame((payload) => this.handleFrame(payload));

    this.simManager.onEnergyStats((payload) => {
      if (this.energyPerNodeEl) {
        this.energyPerNodeEl.textContent = this.formatNumber(payload.perNode);
      }
      if (this.energyRelDevEl) {
        this.energyRelDevEl.textContent = this.formatRelDeviation(
          payload.relDev,
        );
      }
    });

    this.controls.onReset = (preset, k, p2, p3, temp) =>
      this.handleReset(preset, k, p2, p3, temp);
    this.controls.onParamChange = (j, m, t) =>
      this.simManager.updateParams(j, m, t);
    this.controls.onArrowChange = (show) =>
      this.simManager.setRenderOptions(show);
    this.controls.onStartStop = (running) =>
      running ? this.simManager.start() : this.simManager.stop();

    // Help Dialog
    const helpBtn = document.getElementById("help-btn");
    const helpOverlay = document.getElementById("help-overlay");
    const closeHelp = document.getElementById("close-help");

    helpBtn?.addEventListener("click", () => {
      if (helpOverlay) helpOverlay.style.display = "flex";
    });
    closeHelp?.addEventListener("click", () => {
      if (helpOverlay) helpOverlay.style.display = "none";
    });
    helpOverlay?.addEventListener("click", (e) => {
      if (e.target === helpOverlay) helpOverlay.style.display = "none";
    });

    // Persistence
    globalThis.addEventListener("beforeunload", () => this.saveParameters());
    const inputs = [
      this.controls.jInput,
      this.controls.mInput,
      this.controls.timeInput,
      this.controls.tempInput,
      this.controls.lInput,
      this.controls.presetSelect,
      this.controls.kInput,
      this.controls.p2Input,
      this.controls.p3Input,
      this.controls.arrowCheck,
    ];
    inputs.forEach((input) =>
      input.addEventListener("change", () => this.saveParameters())
    );
  }

  private handleFrame(payload: FramePayload) {
    try {
      const {
        imageBitmap,
        theta: thetaBuf,
        omega: omegaBuf,
        orderParameter,
        lSide,
        canvasSize,
        upsample,
      } = payload;

      // Resize canvases if needed
      if (
        this.canvas.width !== canvasSize || this.canvas.height !== canvasSize
      ) {
        this.canvas.width = canvasSize;
        this.canvas.height = canvasSize;
        this.overlayCanvas.width = canvasSize;
        this.overlayCanvas.height = canvasSize;

        // Canvas resize destroys the 2D context - must recreate it
        this.bitmapCtx = this.canvas.getContext("bitmaprenderer");
        this.ctx2d = this.bitmapCtx ? null : this.canvas.getContext("2d");
      }

      // Draw ImageBitmap from WASM visualization
      if (imageBitmap) {
        try {
          if (this.bitmapCtx) {
            this.bitmapCtx.transferFromImageBitmap(imageBitmap);
          } else if (this.ctx2d) {
            this.ctx2d.drawImage(imageBitmap, 0, 0);
          }
        } catch (e) {
          console.error("Error in Canvas2D render:", e);
        }
        imageBitmap.close();
      }

      this.overlayCtx.clearRect(
        0,
        0,
        this.overlayCanvas.width,
        this.overlayCanvas.height,
      );

      // Draw arrows if enabled and disks are large enough
      if (
        this.controls.arrowCheck.checked && thetaBuf && upsample >= 4 &&
        lSide <= 60
      ) {
        try {
          // Check buffer is valid before creating Float32Array
          if (thetaBuf.byteLength > 0) {
            this.drawArrows(
              this.overlayCtx,
              new Float32Array(thetaBuf),
              lSide,
              upsample,
            );
          }
        } catch (e) {
          console.error("Error drawing arrows:", e);
        }
      }

      // Return buffers to worker for recycling after all rendering is done
      this.simManager.returnBuffers(thetaBuf, omegaBuf);

      const now = performance.now();
      if (now - this.lastUiUpdate > UI_UPDATE_INTERVAL_MS) {
        try {
          this.plot.push(
            orderParameter.t,
            orderParameter.r,
            orderParameter.meanOmegaSq,
          );
          this.mdViz.update(
            orderParameter.r,
            orderParameter.meanCos,
            orderParameter.meanSin,
          );
        } catch (e) {
          console.error("Error updating UI:", e);
        }
        this.lastUiUpdate = now;
      }
    } catch (e) {
      console.error("Critical error in handleFrame:", e);
    }
  }

  private handleReset(
    _preset: string,
    _k: number,
    _p2: number,
    _p3: number,
    temp: number,
  ) {
    const lSide = parseInt(this.controls.lInput.value) || DEFAULT_LATTICE_SIZE;
    const { theta, omega } = generateInitialState(
      lSide,
      this.controls.presetSelect.value,
      parseFloat(this.controls.kInput.value),
      parseFloat(this.controls.p2Input.value),
      parseFloat(this.controls.p3Input.value),
      temp,
    );

    const container = this.canvas.parentElement;
    const width = container ? container.clientWidth - CANVAS_PADDING : 600;
    const height = container ? container.clientHeight - CANVAS_PADDING : 600;
    const size = Math.max(100, Math.min(width, height));
    const upsample = Math.max(1, Math.floor(size / lSide));
    this.displaySize = size;

    this.simManager.reset({
      lSide,
      jInput: this.controls.jInput.value,
      mInput: this.controls.mInput.value,
      theta,
      omega,
      upsample,
      showArrows: this.controls.arrowCheck.checked,
    });

    this.plot.reset();
    this.controls.isRunning = false;
    this.controls.startBtn.textContent = "Start";
    this.controls.startBtn.classList.remove("active");
    this.controls.toggleInputs(true);
  }

  private drawArrows(
    ctx: CanvasRenderingContext2D,
    theta: Float32Array,
    lSide: number,
    upsample: number,
  ) {
    const L = lSide;
    const S = upsample;
    const centerOffset = (S - 1) / 2.0;

    // Scale factor to match the [-0.5, 0.5] range of WebGL geometry into pixel space
    const scale = S;

    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";

    for (let r = 0; r < L; r++) {
      for (let c = 0; c < L; c++) {
        const idx = r * L + c;
        const th = theta[idx];
        const cx = c * S + centerOffset;
        const cy = r * S + centerOffset;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-th); // CCW rotation parity
        ctx.scale(scale, scale);

        // Ensure line width is exactly 1 pixel in screen space (or 0.5 unit if scale=1)
        ctx.lineWidth = 0.5 / scale;

        // Draw shaft (rectangle from -0.03, -0.45 to 0.03, 0.15)
        ctx.beginPath();
        ctx.rect(-0.03, -0.45, 0.06, 0.6);
        ctx.fill();
        ctx.stroke();

        // Draw head (triangle from -0.12, 0.15 to 0.12, 0.15 to 0, 0.45)
        ctx.beginPath();
        ctx.moveTo(-0.12, 0.15);
        ctx.lineTo(0.12, 0.15);
        ctx.lineTo(0, 0.45);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
      }
    }
  }

  private formatNumber(value: number): string {
    if (!Number.isFinite(value)) return "—";
    const absValue = Math.abs(value);
    if (absValue >= 0.01 && absValue < 1000) return value.toFixed(4);
    return value.toExponential(3);
  }

  private formatRelDeviation(value: number): string {
    if (!Number.isFinite(value)) return "—";
    return value.toExponential(1);
  }

  private saveParameters() {
    try {
      const params = {
        lSide: this.controls.lInput.value,
        preset: this.controls.presetSelect.value,
        k: this.controls.kInput.value,
        p2: this.controls.p2Input.value,
        p3: this.controls.p3Input.value,
        j: this.controls.jInput.value,
        m: this.controls.mInput.value,
        timeScale: this.controls.timeInput.value,
        temp: this.controls.tempInput.value,
        showArrows: this.controls.arrowCheck.checked,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
    } catch { /* ignore */ }
  }

  private loadParameters() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const params = JSON.parse(saved) as Record<string, unknown>;
        const lSide = getStoredString(params, "lSide");
        if (lSide !== undefined) this.controls.lInput.value = lSide;

        const preset = getStoredString(params, "preset");
        if (preset !== undefined) this.controls.presetSelect.value = preset;

        // Load preset-specific parameters
        const k = getStoredString(params, "k");
        if (k !== undefined) this.controls.kInput.value = k;
        const p2 = getStoredString(params, "p2");
        if (p2 !== undefined) this.controls.p2Input.value = p2;
        const p3 = getStoredString(params, "p3");
        if (p3 !== undefined) this.controls.p3Input.value = p3;

        const j = getStoredNumberWithLegacyScaling(params, "j", 20);
        if (j !== undefined) {
          this.controls.jInput.value = j.toString();
          this.controls.jInput.dispatchEvent(new Event("input"));
        }

        const m = getStoredNumberWithLegacyScaling(params, "m", 10);
        if (m !== undefined) {
          this.controls.mInput.value = m.toString();
          this.controls.mInput.dispatchEvent(new Event("input"));
        }

        const timeScale = getStoredNumberWithLegacyScaling(
          params,
          "timeScale",
          10,
        );
        if (timeScale !== undefined) {
          this.controls.timeInput.value = timeScale.toString();
          this.controls.timeInput.dispatchEvent(new Event("input"));
        }

        const temp = getStoredNumberWithLegacyScaling(params, "temp", 2);
        if (temp !== undefined) {
          this.controls.tempInput.value = temp.toString();
          this.controls.tempInput.dispatchEvent(new Event("input"));
        }

        const showArrows = getStoredBoolean(params, "showArrows");
        if (showArrows !== undefined) {
          this.controls.arrowCheck.checked = showArrows;
        }

        this.controls.updatePresetUI(true);
      }
    } catch { /* ignore */ }
  }
}

// Start the application
new App();

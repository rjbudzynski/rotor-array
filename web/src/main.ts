import {
  ColorBarVisualizer,
  ControlPanel,
  MeanDirectionVisualizer,
  OrderPlot,
} from "./ui.ts";
import { generateInitialState } from "./presets.ts";
import {
  UI_UPDATE_INTERVAL_MS,
  CANVAS_PADDING,
  SLIDER_SCALE,
  DEFAULT_LATTICE_SIZE,
  MIN_LATTICE_SIZE,
  MAX_LATTICE_SIZE,
} from "./constants.ts";

const canvas = document.getElementById("sim-canvas") as HTMLCanvasElement;
const mdCanvas = document.getElementById(
  "mean-dir-canvas",
) as HTMLCanvasElement;

// Get canvas context for drawing ImageBitmap
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Failed to get canvas context");

const mdViz = new MeanDirectionVisualizer(mdCanvas);
const plot = new OrderPlot("uplot-chart");
const controls = new ControlPanel("controls-container");
new ColorBarVisualizer("color-bar-container");

const worker = new Worker(new URL("./worker.js", import.meta.url), {
  type: "module",
});
worker.postMessage({ type: "init" });

let lastUiUpdate = 0;

worker.onmessage = (e) => {
  const { type, payload } = e.data;

  if (type === "frame") {
    const { imageBitmap, theta: thetaBuf, orderParameter, lSide, canvasSize, upsample } = payload;

    // Resize canvas if needed
    if (canvas.width !== canvasSize || canvas.height !== canvasSize) {
      canvas.width = canvasSize;
      canvas.height = canvasSize;
    }

    // Clear canvas to prevent arrow artifacts from previous frames
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw ImageBitmap directly (WASM-rendered visualization)
    // ImageBitmap is transferred, not a Promise
    ctx.drawImage(imageBitmap, 0, 0);

    // Draw arrows if enabled and disks are large enough
    if (controls.arrowCheck.checked && upsample >= 4 && lSide <= 60) {
      drawArrows(ctx, new Float64Array(thetaBuf), lSide, upsample);
    }

    const now = performance.now();
    if (now - lastUiUpdate > UI_UPDATE_INTERVAL_MS) {
      plot.push(orderParameter.t, orderParameter.r);
      mdViz.update(
        orderParameter.r,
        orderParameter.meanCos,
        orderParameter.meanSin,
      );
      lastUiUpdate = now;
    }
  }
};

/**
 * Draw direction arrows on the canvas.
 * Arrows are drawn when individual rotors are large enough to see.
 * @param ctx - Canvas rendering context
 * @param theta - Float64Array of rotor angles
 * @param lSide - Lattice side length (L)
 * @param upsample - Pixel multiplier per rotor
 */
function drawArrows(ctx: CanvasRenderingContext2D, theta: Float64Array, lSide: number, upsample: number) {
  const L = lSide;
  const S = upsample;
  const centerOffset = (S - 1) / 2.0;
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
      const ey = cy + arrowLen * Math.cos(th);
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
    }
  }
  ctx.stroke();
}

controls.onReset = (preset, k, p2, p3, temp) => {
  const lSide = parseInt(controls.lInput.value) || DEFAULT_LATTICE_SIZE;
  const { theta, omega } = generateInitialState(lSide, preset, k, p2, p3, temp);

  // Calculate upsample based on canvas size (same logic as before)
  const container = canvas.parentElement;
  const width = container ? container.clientWidth - CANVAS_PADDING : 600;
  const height = container ? container.clientHeight - CANVAS_PADDING : 600;
  const size = Math.max(100, Math.min(width, height));
  const upsample = Math.max(1, Math.floor(size / lSide));

  worker.postMessage({
    type: "reset",
    payload: {
      lSide,
      jCoupling: parseFloat(controls.jInput.value) / SLIDER_SCALE,
      mField: parseFloat(controls.mInput.value) / SLIDER_SCALE,
      theta,
      omega,
      upsample,
    },
  });

  plot.reset();
  controls.isRunning = false;
  controls.startBtn.textContent = "Start";
  controls.startBtn.classList.remove("active");
  controls.toggleInputs(true);
};

controls.onParamChange = (j, m, t) => {
  worker.postMessage({ type: "updateParams", payload: { j, m, t } });
};

controls.onStartStop = (running) => {
  worker.postMessage({ type: running ? "start" : "stop" });
};

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
  if (e.target === helpOverlay) {
    helpOverlay.style.display = "none";
  }
});

setTimeout(() => {
  controls.triggerReset();
}, 200);

// ============================================================================
// LOCAL STORAGE PERSISTENCE
// ============================================================================

const STORAGE_KEY = "rotorArrayParams";

/**
 * Save current parameters to localStorage.
 * Called before page unload and when parameters change.
 */
function saveParameters() {
  try {
    const params = {
      lSide: controls.lInput.value,
      preset: controls.presetSelect.value,
      j: controls.jInput.value,
      m: controls.mInput.value,
      timeScale: controls.timeInput.value,
      temp: controls.tempInput.value,
      showArrows: controls.arrowCheck.checked,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {
    // localStorage may not be available (private mode, etc.)
  }
}

/**
 * Load saved parameters from localStorage.
 * Called on page load.
 */
function loadParameters() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const params = JSON.parse(saved);
      
      // Restore values if they exist
      if (params.lSide) controls.lInput.value = params.lSide;
      if (params.preset) controls.presetSelect.value = params.preset;
      if (params.j) {
        controls.jInput.value = params.j;
        // Update label
        const val = parseFloat(params.j) / SLIDER_SCALE;
        // Find and update the label
        const jLabel = controls.jInput.parentElement?.querySelector("label");
        if (jLabel) jLabel.textContent = `Coupling (J): ${val.toFixed(2)}`;
      }
      if (params.m) {
        controls.mInput.value = params.m;
        const val = parseFloat(params.m) / SLIDER_SCALE;
        const mLabel = controls.mInput.parentElement?.querySelector("label");
        if (mLabel) mLabel.textContent = `Field (M): ${val.toFixed(2)}`;
      }
      if (params.timeScale) {
        controls.timeInput.value = params.timeScale;
        const val = parseFloat(params.timeScale) / SLIDER_SCALE;
        const tLabel = controls.timeInput.parentElement?.querySelector("label");
        if (tLabel) tLabel.textContent = `Time Scale: ${val.toFixed(1)}x`;
      }
      if (params.temp) {
        controls.tempInput.value = params.temp;
        const val = parseFloat(params.temp) / SLIDER_SCALE;
        const tempLabel = controls.tempInput.parentElement?.querySelector("label");
        if (tempLabel) tempLabel.textContent = `Initial Temp (T): ${val.toFixed(2)}`;
      }
      if (params.showArrows !== undefined) {
        controls.arrowCheck.checked = params.showArrows;
      }
      
      // Update preset-specific UI (k, p2, p3 fields)
      controls.updatePresetUI();
    }
  } catch {
    // localStorage may not be available or data may be corrupt
  }
}

// Load saved parameters on startup
loadParameters();

// Save parameters when window is about to close
window.addEventListener("beforeunload", saveParameters);

// Save parameters when they change
controls.jInput.addEventListener("change", saveParameters);
controls.mInput.addEventListener("change", saveParameters);
controls.timeInput.addEventListener("change", saveParameters);
controls.tempInput.addEventListener("change", saveParameters);
controls.lInput.addEventListener("change", saveParameters);
controls.presetSelect.addEventListener("change", saveParameters);
controls.arrowCheck.addEventListener("change", saveParameters);

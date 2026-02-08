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
    const { imageBitmap, orderParameter, lSide, canvasSize } = payload;

    // Resize canvas if needed
    if (canvas.width !== canvasSize || canvas.height !== canvasSize) {
      canvas.width = canvasSize;
      canvas.height = canvasSize;
    }

    // Draw ImageBitmap directly (WASM-rendered visualization)
    // ImageBitmap is transferred, not a Promise
    ctx.drawImage(imageBitmap, 0, 0);

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

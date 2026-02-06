import {
  ColorBarVisualizer,
  ControlPanel,
  MeanDirectionVisualizer,
  OrderPlot,
} from "./ui.ts";
import { RotorArrayVisualizer } from "./visualizer.ts";
import { generateInitialState } from "./presets.ts";

const canvas = document.getElementById("sim-canvas") as HTMLCanvasElement;
const mdCanvas = document.getElementById(
  "mean-dir-canvas",
) as HTMLCanvasElement;

const visualizer = new RotorArrayVisualizer(canvas);
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
    const { theta: thetaBuf, omega: omegaBuf, orderParameter, lSide } = payload;

    // Fast TypedArray views of transferable buffers
    const theta = new Float64Array(thetaBuf);
    const omega = new Float64Array(omegaBuf);

    // Sync visualizer state and render
    visualizer.setLSide(lSide);
    visualizer.update(theta, omega, controls.arrowCheck.checked);

    const now = performance.now();
    if (now - lastUiUpdate > 100) {
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
  const lSide = parseInt(controls.lInput.value) || 20;
  const { theta, omega } = generateInitialState(lSide, preset, k, p2, p3, temp);

  // Sync visualizer immediately to prevent black screen or jump
  visualizer.setLSide(lSide);

  worker.postMessage({
    type: "reset",
    payload: {
      lSide,
      jCoupling: parseFloat(controls.jInput.value) / 100,
      mField: parseFloat(controls.mInput.value) / 100,
      theta,
      omega,
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

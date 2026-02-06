import init, {
  WasmSimulationEngine,
  WasmVisualizer,
} from "../simulation-wasm/pkg/simulation_wasm.js";

let engine: WasmSimulationEngine | null = null;
let visualizer: WasmVisualizer | null = null;
let wasmExports: unknown = null;
let currentLSide = 0;

let running = false;
let timeScale = 1.0;
let lastFrame = 0;
let accumulator = 0;
let lastEmit = 0;
const SIM_DT = 0.016;

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  switch (type) {
    case "init":
      wasmExports = await init();
      self.postMessage({ type: "initialized" });
      break;

    case "reset": {
      const { lSide, jCoupling, mField, theta, omega, upsample } = payload;
      currentLSide = lSide;
      engine = new WasmSimulationEngine(lSide, jCoupling, mField);
      engine.set_state(theta, omega, 0);
      visualizer = new WasmVisualizer(lSide, upsample);

      lastFrame = performance.now();
      accumulator = 0;
      running = false;

      renderFrame();
      break;
    }

    case "start":
      if (!running) {
        running = true;
        lastFrame = performance.now();
        loop();
      }
      break;

    case "stop":
      running = false;
      break;

    case "updateParams":
      engine?.update_params(payload.j, payload.m);
      timeScale = payload.t;
      break;
  }
};

function renderFrame() {
  if (!engine || !visualizer || !wasmExports) return;

  const N = currentLSide * currentLSide;
  visualizer.update(engine.get_theta_ptr(), engine.get_omega_ptr(), N);

  // deno-lint-ignore no-explicit-any
  const memory = (wasmExports as any).memory.buffer;
  const rgbaPtr = visualizer.get_rgba_ptr();
  const rgbaSize = visualizer.get_rgba_size();
  const rgbaView = new Uint8ClampedArray(
    memory,
    rgbaPtr,
    rgbaSize,
  );

  const buffer = rgbaView.slice().buffer;

  const theta = new Float64Array(
    memory,
    engine.get_theta_ptr(),
    N,
  ).slice();
  const omega = new Float64Array(
    memory,
    engine.get_omega_ptr(),
    N,
  ).slice();

  const op = {
    r: engine.get_order_parameter_r(),
    meanCos: engine.get_order_parameter_mean_cos(),
    meanSin: engine.get_order_parameter_mean_sin(),
    t: engine.get_t(),
  };

  self.postMessage({
    type: "frame",
    payload: {
      buffer,
      theta: theta.buffer,
      omega: omega.buffer,
      orderParameter: op,
      lSide: currentLSide,
      upsample: visualizer.upsample,
    },
  }, [buffer, theta.buffer, omega.buffer]);

  lastEmit = performance.now();
}

function loop() {
  if (!running || !engine || !visualizer || !wasmExports) return;

  const timestamp = performance.now();
  const frameDt = (timestamp - lastFrame) / 1000;
  lastFrame = timestamp;

  accumulator += Math.min(frameDt, 0.1);

  while (accumulator >= SIM_DT) {
    engine.step(SIM_DT * timeScale);
    accumulator -= SIM_DT;
  }

  const now = performance.now();
  if (now - lastEmit >= 16.6) {
    renderFrame();
  }

  if (running) {
    setTimeout(loop, 0);
  }
}

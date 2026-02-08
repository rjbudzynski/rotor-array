import init, {
  WasmSimulationEngine,
  WasmVisualizer,
} from "../simulation-wasm/pkg/simulation_wasm.js";

/** WASM module exports from wasm-bindgen */
interface WasmExports {
  memory: WebAssembly.Memory;
}

let engine: WasmSimulationEngine | null = null;
let visualizer: WasmVisualizer | null = null;
let wasmExports: WasmExports | null = null;
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
      wasmExports = await init() as WasmExports;
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

// Reusable buffers to avoid per-frame allocations
let rgbaBuffer: Uint8ClampedArray | null = null;
let thetaBuffer: Float64Array | null = null;
let omegaBuffer: Float64Array | null = null;

function renderFrame() {
  if (!engine || !visualizer || !wasmExports) return;

  const N = currentLSide * currentLSide;
  visualizer.update(engine.get_theta_ptr(), engine.get_omega_ptr(), N);

  const memory = wasmExports.memory.buffer;

  // Get WASM memory pointers and sizes
  const rgbaPtr = visualizer.get_rgba_ptr();
  const rgbaSize = visualizer.get_rgba_size();
  const thetaPtr = engine.get_theta_ptr();
  const omegaPtr = engine.get_omega_ptr();

  // Create or resize reusable buffers
  if (!rgbaBuffer || rgbaBuffer.length !== rgbaSize) {
    rgbaBuffer = new Uint8ClampedArray(rgbaSize);
  }
  if (!thetaBuffer || thetaBuffer.length !== N) {
    thetaBuffer = new Float64Array(N);
  }
  if (!omegaBuffer || omegaBuffer.length !== N) {
    omegaBuffer = new Float64Array(N);
  }

  // Copy data from WASM memory to reusable buffers (single copy, no .slice())
  const rgbaView = new Uint8ClampedArray(memory, rgbaPtr, rgbaSize);
  const thetaView = new Float64Array(memory, thetaPtr, N);
  const omegaView = new Float64Array(memory, omegaPtr, N);

  rgbaBuffer.set(rgbaView);
  thetaBuffer.set(thetaView);
  omegaBuffer.set(omegaView);

  const op = {
    r: engine.get_order_parameter_r(),
    meanCos: engine.get_order_parameter_mean_cos(),
    meanSin: engine.get_order_parameter_mean_sin(),
    t: engine.get_t(),
  };

  // Transfer ownership of buffer underlying ArrayBuffers to main thread
  // deno-lint-ignore no-explicit-any
  (postMessage as any)({
    type: "frame",
    payload: {
      buffer: rgbaBuffer.buffer,
      theta: thetaBuffer.buffer,
      omega: omegaBuffer.buffer,
      orderParameter: op,
      lSide: currentLSide,
    },
  }, [rgbaBuffer.buffer, thetaBuffer.buffer, omegaBuffer.buffer]);

  // Buffers are now transferred and unusable; they will be recreated on next frame
  rgbaBuffer = null;
  thetaBuffer = null;
  omegaBuffer = null;

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

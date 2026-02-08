import init, {
  WasmSimulationEngine,
  WasmVisualizer,
} from "../simulation-wasm/pkg/simulation_wasm.js";
import {
  SIMULATION_TIMESTEP,
  MAX_ACCUMULATOR,
  FRAME_EMIT_INTERVAL_MS,
} from "./constants.ts";

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
let thetaBuffer: Float64Array | null = null;
let omegaBuffer: Float64Array | null = null;

async function renderFrame() {
  if (!engine || !visualizer || !wasmExports) return;

  const N = currentLSide * currentLSide;
  visualizer.update(engine.get_theta_ptr(), engine.get_omega_ptr(), N);

  const memory = wasmExports.memory.buffer;

  // Get WASM memory pointers and sizes
  const rgbaPtr = visualizer.get_rgba_ptr();
  const rgbaSize = visualizer.get_rgba_size();
  const thetaPtr = engine.get_theta_ptr();
  const omegaPtr = engine.get_omega_ptr();

  // Create ImageData from WASM memory (zero-copy view)
  const rgbaView = new Uint8ClampedArray(memory, rgbaPtr, rgbaSize);
  const canvasSize = Math.sqrt(rgbaSize / 4); // RGBA = 4 bytes per pixel
  const imageData = new ImageData(rgbaView, canvasSize, canvasSize);

  // Create ImageBitmap for efficient transfer to main thread
  const imageBitmap = await createImageBitmap(imageData);

  // Create or resize reusable buffers for theta/omega
  if (!thetaBuffer || thetaBuffer.length !== N) {
    thetaBuffer = new Float64Array(N);
  }
  if (!omegaBuffer || omegaBuffer.length !== N) {
    omegaBuffer = new Float64Array(N);
  }

  // Copy theta/omega from WASM memory
  const thetaView = new Float64Array(memory, thetaPtr, N);
  const omegaView = new Float64Array(memory, omegaPtr, N);
  thetaBuffer.set(thetaView);
  omegaBuffer.set(omegaView);

  const op = {
    r: engine.get_order_parameter_r(),
    meanCos: engine.get_order_parameter_mean_cos(),
    meanSin: engine.get_order_parameter_mean_sin(),
    t: engine.get_t(),
  };

  // Calculate current upsample for arrow rendering
  const upsample = Math.floor(canvasSize / currentLSide);

  // Transfer ImageBitmap and theta/omega buffers to main thread
  // deno-lint-ignore no-explicit-any
  (postMessage as any)({
    type: "frame",
    payload: {
      imageBitmap,
      theta: thetaBuffer.buffer,
      omega: omegaBuffer.buffer,
      lSide: currentLSide,
      canvasSize,
      upsample,
      orderParameter: op,
    },
  }, [imageBitmap, thetaBuffer.buffer, omegaBuffer.buffer]);

  // Buffers are now transferred and unusable
  thetaBuffer = null;
  omegaBuffer = null;

  lastEmit = performance.now();
}

// MessageChannel for tighter scheduling (bypasses setTimeout 4ms minimum)
const scheduleChannel = new MessageChannel();
scheduleChannel.port2.onmessage = () => {
  if (running) {
    loop();
  }
};
const scheduleNext = () => scheduleChannel.port1.postMessage(null);

function loop() {
  if (!running || !engine || !visualizer || !wasmExports) return;

  const timestamp = performance.now();
  const frameDt = (timestamp - lastFrame) / 1000;
  lastFrame = timestamp;

  accumulator += Math.min(frameDt, 0.1);

  while (accumulator >= SIMULATION_TIMESTEP) {
    engine.step(SIMULATION_TIMESTEP * timeScale);
    accumulator -= SIMULATION_TIMESTEP;
  }

  const now = performance.now();
  if (now - lastEmit >= FRAME_EMIT_INTERVAL_MS) {
    renderFrame();
  }

  if (running) {
    scheduleNext();
  }
}

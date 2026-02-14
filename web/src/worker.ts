/// <reference lib="webworker" />
import init, {
  WasmSimulationEngine,
  WasmVisualizer,
} from "../simulation-wasm/pkg/simulation_wasm.js";
import {
  FRAME_EMIT_INTERVAL_MS,
  MAX_ACCUMULATOR,
  SIMULATION_TIMESTEP,
} from "./constants.ts";

/** WASM module exports from wasm-bindgen */
interface WasmExports {
  memory: WebAssembly.Memory;
}

let engine: WasmSimulationEngine | null = null;
let visualizer: WasmVisualizer | null = null;
let wasmExports: WasmExports | null = null;
let currentLSide = 0;
let currentUpsample = 1;
const canUseOffscreenCanvas = typeof OffscreenCanvas !== "undefined";

let offscreenCanvas: OffscreenCanvas | null = null;
let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;
let offscreenSize = 0;

let running = false;
let timeScale = 1.0;
let lastFrame = 0;
let accumulator = 0;
let lastEmit = 0;
let lastEnergyEmit = 0;
let initialEnergyPerNode = 0;
let showArrows = true;
let renderMode: "webgl2" | "canvas2d" = "webgl2";

let initPromise: Promise<WasmExports> | null = null;

let rendering = false;

function ensureInit(): Promise<WasmExports> {
  if (wasmExports) return Promise.resolve(wasmExports);
  if (!initPromise) {
    initPromise = init().then((exports) => {
      wasmExports = exports as WasmExports;
      return wasmExports;
    });
  }
  return initPromise;
}

self.onerror = (e) => {
  console.error("[RotorArrayWorker] Unhandled error:", e);
};

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  switch (type) {
    case "init":
      await ensureInit();
      self.postMessage({ type: "initialized" });
      break;

    case "reset": {
      await ensureInit();
      const {
        lSide,
        jCoupling,
        mField,
        theta,
        omega,
        upsample,
        showArrows: showArrowsPayload,
      } = payload;
      currentLSide = lSide;
      currentUpsample = upsample;
      engine = new WasmSimulationEngine(lSide, jCoupling, mField);

      engine.set_state(theta, omega, 0);
      
      if (!visualizer) {
        visualizer = new WasmVisualizer(lSide, upsample);
      } else {
        visualizer.set_dimensions(lSide, upsample);
      }
      
      if (typeof showArrowsPayload === "boolean") {

        showArrows = showArrowsPayload;
      }

      lastFrame = performance.now();
      accumulator = 0;
      running = false;
      lastEnergyEmit = 0;
      const n = currentLSide * currentLSide;
      initialEnergyPerNode = n > 0 ? engine.get_energy() / n : 0;
      emitEnergyStats();

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

    case "setRenderOptions":
      if (typeof payload.showArrows === "boolean") {
        showArrows = payload.showArrows;
      }
      break;

    case "setRenderMode":
      if (payload.mode === "webgl2" || payload.mode === "canvas2d") {
        renderMode = payload.mode;
      }
      break;

    case "returnBuffers":
      if (payload.theta instanceof ArrayBuffer) {
        thetaPool.push(payload.theta);
      }
      if (payload.omega instanceof ArrayBuffer) {
        omegaPool.push(payload.omega);
      }
      break;

    case "requestFrame":
      renderFrame();
      break;

    case "updateUpsample":
      if (typeof payload.upsample === "number") {
        currentUpsample = payload.upsample;
        visualizer?.set_dimensions(currentLSide, currentUpsample);
      }
      break;
  }
};

// Reusable buffers to avoid per-frame allocations
const thetaPool: ArrayBuffer[] = [];
const omegaPool: ArrayBuffer[] = [];
let thetaBuffer: Float32Array | null = null;
let omegaBuffer: Float32Array | null = null;



// Always transfer raw arrays for WebGL2 texture pipeline
const transferRawArrays = true;

async function renderFrame() {
  if (!engine || !visualizer || !wasmExports) return;
  if (rendering) return;
  rendering = true;

  try {
    const N = currentLSide * currentLSide;
    const memory = wasmExports.memory.buffer;
    const thetaPtr = engine.get_theta_ptr();
    const omegaPtr = engine.get_omega_ptr();

    let imageBitmap: ImageBitmap | undefined;
    let canvasSize = 0;

    if (renderMode === "canvas2d") {
      visualizer.update(thetaPtr, omegaPtr, N);

      // Get WASM memory pointers and sizes for pixel data
      const rgbaPtr = visualizer.get_rgba_ptr();
      const rgbaSize = visualizer.get_rgba_size();

      // Create ImageData from WASM memory (zero-copy view)
      const rgbaView = new Uint8ClampedArray(memory, rgbaPtr, rgbaSize);
      canvasSize = Math.sqrt(rgbaSize / 4); // RGBA = 4 bytes per pixel
      const imageData = new ImageData(rgbaView, canvasSize, canvasSize);

      // Create ImageBitmap for efficient transfer to main thread
      try {
        // Direct creation from ImageData is usually well-optimized
        imageBitmap = await createImageBitmap(imageData);
      } catch (err) {
        console.error("Failed to create ImageBitmap from ImageData:", err);
        // Fallback: try using OffscreenCanvas if available
        if (canUseOffscreenCanvas) {
          if (!offscreenCanvas || offscreenSize !== canvasSize) {
            offscreenCanvas = new OffscreenCanvas(canvasSize, canvasSize);
            offscreenCtx = offscreenCanvas.getContext("2d");
            offscreenSize = canvasSize;
          }
          if (offscreenCanvas && offscreenCtx) {
            offscreenCtx.putImageData(imageData, 0, 0);
            imageBitmap = offscreenCanvas.transferToImageBitmap();
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
    } else {
      // In WebGL2 mode, we still need to know the target canvas size for upsample calculations
      canvasSize = currentLSide * currentUpsample;
    }


            if (transferRawArrays || showArrows) {

              // Create or reuse reusable buffers for theta/omega

              // Check if current buffers are detached (byteLength === 0)

              if (!thetaBuffer || thetaBuffer.byteLength === 0) {

                const buf = thetaPool.pop();

                if (buf && buf.byteLength === N * 4) {

                  thetaBuffer = new Float32Array(buf);

                } else {

                  thetaBuffer = new Float32Array(N);

                }

              }

              if (!omegaBuffer || omegaBuffer.byteLength === 0) {

                const buf = omegaPool.pop();

                if (buf && buf.byteLength === N * 4) {

                  omegaBuffer = new Float32Array(buf);

                } else {

                  omegaBuffer = new Float32Array(N);

                }

              }

        

              // Copy theta/omega from WASM memory (F64 -> F32 conversion happens here)

              const thetaView = new Float64Array(memory, thetaPtr, N);

              const omegaView = new Float64Array(memory, omegaPtr, N);

              thetaBuffer.set(thetaView);

              omegaBuffer.set(omegaView);

            }

        

    // deno-lint-ignore no-explicit-any
    const opArr = (engine as any).get_order_parameter(); // [r, meanCos, meanSin] — single pass
    const op = {
      r: opArr[0],
      meanCos: opArr[1],
      meanSin: opArr[2],
      t: engine.get_t(),
    };

    // Calculate current upsample for arrow rendering
    const upsample = Math.floor(canvasSize / currentLSide);

    // Transfer ImageBitmap and theta/omega buffers to main thread
    const payload = {
      imageBitmap,
      lSide: currentLSide,
      canvasSize,
      upsample,
      orderParameter: op,
    } as {
      imageBitmap?: ImageBitmap;
      lSide: number;
      canvasSize: number;
      upsample: number;
      orderParameter: typeof op;
      theta?: ArrayBuffer;
      omega?: ArrayBuffer;
    };

    const transfer: Transferable[] = [];
    if (imageBitmap) {
      transfer.push(imageBitmap);
    }
    if ((transferRawArrays || showArrows) && thetaBuffer && omegaBuffer) {

      payload.theta = thetaBuffer.buffer as ArrayBuffer;
      payload.omega = omegaBuffer.buffer as ArrayBuffer;
      transfer.push(thetaBuffer.buffer, omegaBuffer.buffer);
    }

    self.postMessage({
      type: "frame",
      payload,
    }, transfer);

    // Buffers are now transferred and unusable
    if (showArrows) {
      thetaBuffer = null;
      omegaBuffer = null;
    }

    lastEmit = performance.now();
  } finally {
    rendering = false;
  }
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

  accumulator += Math.min(frameDt, MAX_ACCUMULATOR);

  while (accumulator >= SIMULATION_TIMESTEP) {
    engine.step(SIMULATION_TIMESTEP * timeScale);
    accumulator -= SIMULATION_TIMESTEP;
  }

  const now = performance.now();
  if (now - lastEmit >= FRAME_EMIT_INTERVAL_MS) {
    renderFrame();
  }
  if (now - lastEnergyEmit >= 1000) {
    emitEnergyStats();
  }

  if (running) {
    scheduleNext();
  }
}

function emitEnergyStats() {
  if (!engine) return;
  const n = currentLSide * currentLSide;
  const perNode = n > 0 ? engine.get_energy() / n : 0;
  const relDev = initialEnergyPerNode === 0
    ? 0
    : (perNode - initialEnergyPerNode) / initialEnergyPerNode;
  lastEnergyEmit = performance.now();
  self.postMessage({
    type: "energyStats",
    payload: {
      perNode,
      relDev,
    },
  });
}

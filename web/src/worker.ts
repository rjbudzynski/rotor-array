import init, { WasmSimulationEngine } from "../simulation-wasm/pkg/simulation_wasm.js";

let engine: WasmSimulationEngine | null = null;
let wasmExports: any = null;
let currentLSide: number = 0;

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

    case "reset":
      const { lSide, jCoupling, mField, theta, omega } = payload;
      currentLSide = lSide;
      engine = new WasmSimulationEngine(lSide, jCoupling, mField);
      engine.set_state(theta, omega, 0);
      
      lastFrame = performance.now();
      accumulator = 0;
      running = false;
      
      // Post initial frame immediately
      renderFrame();
      break;

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
  if (!engine || !wasmExports) return;

  const N = currentLSide * currentLSide;
  
  const thetaPtr = engine.get_theta_ptr();
  const omegaPtr = engine.get_omega_ptr();
  
  const thetaView = new Float64Array(wasmExports.memory.buffer, thetaPtr, N);
  const omegaView = new Float64Array(wasmExports.memory.buffer, omegaPtr, N);
  
  const theta = thetaView.slice();
  const omega = omegaView.slice();

  const op = {
      r: engine.get_order_parameter_r(),
      meanCos: engine.get_order_parameter_mean_cos(),
      meanSin: engine.get_order_parameter_mean_sin(),
      t: engine.get_t()
  };

  self.postMessage({
    type: "frame",
    payload: {
      theta: theta.buffer,
      omega: omega.buffer,
      orderParameter: op,
      lSide: currentLSide
    }
  }, [theta.buffer, omega.buffer]);
  
  lastEmit = performance.now();
}

function loop() {
  if (!running || !engine || !wasmExports) return;

  const timestamp = performance.now();
  const frameDt = (timestamp - lastFrame) / 1000;
  lastFrame = timestamp;

  accumulator += Math.min(frameDt, 0.1);

  while (accumulator >= SIM_DT) {
    engine.step(SIM_DT * timeScale);
    accumulator -= SIM_DT;
  }

  // Throttle visual updates to ~60Hz
  const now = performance.now();
  if (now - lastEmit >= 16.6) {
      renderFrame();
  }

  if (running) {
      setTimeout(loop, 0);
  }
}

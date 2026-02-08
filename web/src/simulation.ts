import init, {
  WasmSimulationEngine,
} from "../simulation-wasm/pkg/simulation_wasm.js";

export interface SimulationParams {
  lSide: number;
  jCoupling: number;
  mField: number;
}

export interface OrderParameter {
  r: number;
  meanCos: number;
  meanSin: number;
}

/** WASM module exports from wasm-bindgen */
export interface WasmExports {
  memory: WebAssembly.Memory;
}

export class SimulationEngine {
  params: SimulationParams;
  wasm: WasmSimulationEngine | null = null;
  wasmExports: WasmExports | null = null;

  // These will point to WASM memory
  private _theta: Float64Array | null = null;
  private _omega: Float64Array | null = null;

  t: number = 0;
  adaptiveSubstepping = true;
  substeps = 10;
  stabilityFactor = 0.006;

  constructor(params: SimulationParams) {
    this.params = { ...params };
  }

  async initialize() {
    this.wasmExports = await init() as WasmExports;
    this.wasm = new WasmSimulationEngine(
      this.params.lSide,
      this.params.jCoupling,
      this.params.mField,
    );
  }

  // Helper to get views of WASM memory
  private updateViews() {
    if (!this.wasm || !this.wasmExports) return;
    const memory = this.wasmExports.memory.buffer;
    const thetaPtr = this.wasm.get_theta_ptr();
    const omegaPtr = this.wasm.get_omega_ptr();
    const N = this.params.lSide * this.params.lSide;

    this._theta = new Float64Array(memory, thetaPtr, N);
    this._omega = new Float64Array(memory, omegaPtr, N);
  }

  get theta(): Float64Array {
    if (!this._theta || this._theta.byteLength === 0) this.updateViews();
    return this._theta!;
  }

  get omega(): Float64Array {
    if (!this._omega || this._omega.byteLength === 0) this.updateViews();
    return this._omega!;
  }

  setState(theta: Float64Array, omega: Float64Array, t: number = 0) {
    if (this.wasm) {
      this.wasm.set_state(theta, omega, t);
      this.updateViews(); // Pointers might have changed (unlikely for fixed size, but good practice)
    }
    this.t = t;
  }

  updateParams(j?: number, m?: number) {
    if (j !== undefined) this.params.jCoupling = j;
    if (m !== undefined) this.params.mField = m;
    if (this.wasm) {
      this.wasm.update_params(j, m);
    }
  }

  step(dt: number) {
    if (!this.wasm) return;

    // We let WASM handle sub-stepping too for maximum speed
    // Actually, I didn't implement adaptive substepping IN the WASM verlet_step,
    // but I did in WASM step().

    this.wasm.step(dt);
    this.t = this.wasm.get_t();
  }

  getEnergy(): number {
    return this.wasm ? this.wasm.get_energy() : 0;
  }

  getOrderParameter(): OrderParameter {
    if (!this.wasm) return { r: 0, meanCos: 0, meanSin: 0 };
    return {
      r: this.wasm.get_order_parameter_r(),
      meanCos: this.wasm.get_order_parameter_mean_cos(),
      meanSin: this.wasm.get_order_parameter_mean_sin(),
    };
  }
}

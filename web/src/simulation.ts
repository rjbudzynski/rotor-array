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

export class RotorArray {
  params: SimulationParams;
  nRotors: number;

  constructor(params: SimulationParams) {
    if (params.lSide <= 0) throw new Error("lSide must be positive");
    this.params = params;
    this.nRotors = params.lSide * params.lSide;
  }

  getAcceleration(theta: Float64Array, outAccel: Float64Array): void {
    const L = this.params.lSide;
    const J = this.params.jCoupling;
    const M = this.params.mField;

    // idx = row * L + col
    for (let row = 0; row < L; row++) {
      const rowOffset = row * L;
      const upRowOffset = ((row - 1 + L) % L) * L;
      const downRowOffset = ((row + 1) % L) * L;

      for (let col = 0; col < L; col++) {
        const idx = rowOffset + col;
        const theta_i = theta[idx];

        const leftIdx = rowOffset + ((col - 1 + L) % L);
        const rightIdx = rowOffset + ((col + 1) % L);
        const upIdx = upRowOffset + col;
        const downIdx = downRowOffset + col;

        // F_i = J * sum_{neighbors} sin(theta_neighbor - theta_i) - M * sin(theta_i)
        let forceSum = 0;
        forceSum += Math.sin(theta[rightIdx] - theta_i);
        forceSum += Math.sin(theta[leftIdx] - theta_i);
        forceSum += Math.sin(theta[downIdx] - theta_i);
        forceSum += Math.sin(theta[upIdx] - theta_i);

        outAccel[idx] = (J * forceSum) - (M * Math.sin(theta_i));
      }
    }
  }

  hamiltonian(theta: Float64Array, omega: Float64Array): number {
    let kinetic = 0;
    let potential = 0;
    let field = 0;

    const L = this.params.lSide;
    const J = this.params.jCoupling;
    const M = this.params.mField;
    const N = this.nRotors;

    for (let i = 0; i < N; i++) {
      kinetic += 0.5 * omega[i] * omega[i];
      field += -M * Math.cos(theta[i]);
    }

    // Potential over bonds
    for (let row = 0; row < L; row++) {
      const rowOffset = row * L;
      const downRowOffset = ((row + 1) % L) * L;

      for (let col = 0; col < L; col++) {
        const idx = rowOffset + col;
        const rightIdx = rowOffset + ((col + 1) % L);
        const downIdx = downRowOffset + col;

        const t = theta[idx];
        potential += J * (1 - Math.cos(t - theta[rightIdx]));
        potential += J * (1 - Math.cos(t - theta[downIdx]));
      }
    }

    return kinetic + potential + field;
  }
}

export class SimulationEngine {
  params: SimulationParams;
  array: RotorArray;
  theta: Float64Array;
  omega: Float64Array;

  // Acceleration buffer
  private _accel: Float64Array;
  // Acceleration dirty flag (if parameters changed)
  private _accelDirty: boolean = true;

  t: number = 0;

  adaptiveSubstepping = true;
  substeps = 10;
  stabilityFactor = 0.006;

  constructor(params: SimulationParams) {
    this.params = { ...params }; // Copy
    this.array = new RotorArray(this.params);
    const N = params.lSide * params.lSide;
    this.theta = new Float64Array(N);
    this.omega = new Float64Array(N);
    this._accel = new Float64Array(N);
  }

  setState(theta: Float64Array, omega: Float64Array, t: number = 0) {
    if (
      theta.length !== this.theta.length || omega.length !== this.omega.length
    ) {
      throw new Error("State array size mismatch");
    }
    this.theta.set(theta);
    this.omega.set(omega);
    this.t = t;
    this._accelDirty = true;
  }

  updateParams(j?: number, m?: number) {
    if (j !== undefined) this.params.jCoupling = j;
    if (m !== undefined) this.params.mField = m;
    this.array.params = this.params;
    this._accelDirty = true;
  }

  // Velocity Verlet
  verletStep(dt: number) {
    const N = this.params.lSide * this.params.lSide;

    // 0. Ensure initial acceleration
    if (this._accelDirty) {
      this.array.getAcceleration(this.theta, this._accel);
      this._accelDirty = false;
    }

    // 1. v(t + dt/2) = v(t) + a(t) * dt/2
    const halfDt = dt * 0.5;
    for (let i = 0; i < N; i++) {
      this.omega[i] += this._accel[i] * halfDt;
    }

    // 2. x(t + dt) = x(t) + v(t + dt/2) * dt
    for (let i = 0; i < N; i++) {
      this.theta[i] += this.omega[i] * dt;
      // Wrap to [-pi, pi) for numerical stability (optional but good)
      // Standard wrap: ((x + pi) % 2pi) - pi
      // JS % operator can be negative, so be careful.
      // Actually, simple float drift isn't a huge issue for cos/sin,
      // but keeping it bounded is nice.
      // For performance, we might skip this unless necessary, or use a fast wrap.
      // Simulation.py does it.
      let th = this.theta[i];
      if (th > Math.PI || th < -Math.PI) {
        th = (th + Math.PI) % (2 * Math.PI);
        if (th < 0) th += 2 * Math.PI;
        th -= Math.PI;
        this.theta[i] = th;
      }
    }

    // 3. v(t + dt) = v(t + dt/2) + a(t + dt) * dt/2
    // Calc new acceleration
    this.array.getAcceleration(this.theta, this._accel);

    for (let i = 0; i < N; i++) {
      this.omega[i] += this._accel[i] * halfDt;
    }

    this.t += dt;
  }

  step(dt: number) {
    if (this.adaptiveSubstepping) {
      const J = Math.abs(this.params.jCoupling);
      const M = Math.abs(this.params.mField);
      const omegaMax = Math.sqrt(8.0 * J + M + 1e-9);
      this.substeps = Math.max(
        1,
        Math.ceil((dt * omegaMax) / this.stabilityFactor),
      );
    }

    const subDt = dt / this.substeps;
    for (let i = 0; i < this.substeps; i++) {
      this.verletStep(subDt);
    }
  }

  getEnergy(): number {
    return this.array.hamiltonian(this.theta, this.omega);
  }

  getOrderParameter(): OrderParameter {
    const N = this.theta.length;
    let sumCos = 0;
    let sumSin = 0;
    for (let i = 0; i < N; i++) {
      sumCos += Math.cos(this.theta[i]);
      sumSin += Math.sin(this.theta[i]);
    }
    const meanCos = sumCos / N;
    const meanSin = sumSin / N;
    const r = Math.sqrt(meanCos * meanCos + meanSin * meanSin);
    return { r, meanCos, meanSin };
  }
}

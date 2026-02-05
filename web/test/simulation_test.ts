import { assertAlmostEquals } from "@std/assert";
import { SimulationEngine, SimulationParams } from "../src/simulation.ts";

Deno.test("Simulation Energy Conservation", () => {
  const params: SimulationParams = {
    lSide: 10,
    jCoupling: 1.0,
    mField: 0.0,
  };
  const engine = new SimulationEngine(params);

  // Initialize with some random state
  const N = params.lSide * params.lSide;
  const theta = new Float64Array(N);
  const omega = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    theta[i] = Math.random() * 2 * Math.PI - Math.PI;
    omega[i] = (Math.random() - 0.5) * 2.0;
  }
  engine.setState(theta, omega);

  const initialEnergy = engine.getEnergy();
  console.log(`Initial Energy: ${initialEnergy}`);

  // Run for some time
  // dt = 0.1, run 10 steps
  for (let i = 0; i < 10; i++) {
    engine.step(0.1);
  }

  const finalEnergy = engine.getEnergy();
  console.log(`Final Energy: ${finalEnergy}`);

  // Energy should be conserved (within numerical error)
  // Relative error check
  const diff = Math.abs(finalEnergy - initialEnergy);
  const relErr = diff / Math.abs(initialEnergy);

  console.log(`Relative Error: ${relErr}`);

  // With symplectic integrator, error should be small
  if (relErr > 1e-4) {
    throw new Error(`Energy drift too high: ${relErr}`);
  }

  assertAlmostEquals(initialEnergy, finalEnergy, 1e-2); // Loose check for float
});

Deno.test("Order parameter for aligned and anti-aligned states", () => {
  const params: SimulationParams = {
    lSide: 2,
    jCoupling: 0.0,
    mField: 0.0,
  };
  const engine = new SimulationEngine(params);

  const thetaAligned = new Float64Array([0, 0, 0, 0]);
  const omegaZero = new Float64Array(4).fill(0);
  engine.setState(thetaAligned, omegaZero);
  const aligned = engine.getOrderParameter();
  assertAlmostEquals(aligned.r, 1.0, 1e-12);
  assertAlmostEquals(aligned.meanCos, 1.0, 1e-12);
  assertAlmostEquals(aligned.meanSin, 0.0, 1e-12);

  const thetaAnti = new Float64Array([0, Math.PI, 0, Math.PI]);
  engine.setState(thetaAnti, omegaZero);
  const anti = engine.getOrderParameter();
  assertAlmostEquals(anti.r, 0.0, 1e-12);
  assertAlmostEquals(anti.meanCos, 0.0, 1e-12);
  assertAlmostEquals(anti.meanSin, 0.0, 1e-12);
});

Deno.test("Hamiltonian reduces to kinetic + field when J=0", () => {
  const params: SimulationParams = {
    lSide: 1,
    jCoupling: 0.0,
    mField: 2.0,
  };
  const engine = new SimulationEngine(params);
  const theta = new Float64Array([Math.PI / 3]);
  const omega = new Float64Array([3.0]);
  engine.setState(theta, omega);

  const expected = 0.5 * 9.0 - 2.0 * Math.cos(Math.PI / 3);
  assertAlmostEquals(engine.getEnergy(), expected, 1e-12);
});

Deno.test("Free rotor advances linearly when J=M=0", () => {
  const params: SimulationParams = {
    lSide: 1,
    jCoupling: 0.0,
    mField: 0.0,
  };
  const engine = new SimulationEngine(params);
  const theta = new Float64Array([0.0]);
  const omega = new Float64Array([1.0]);
  engine.setState(theta, omega);

  engine.step(0.1);
  assertAlmostEquals(engine.theta[0], 0.1, 1e-9);
  assertAlmostEquals(engine.omega[0], 1.0, 1e-12);
});

Deno.test("Field Effect", () => {
  const params: SimulationParams = {
    lSide: 4,
    jCoupling: 0.0, // No coupling, independent rotors
    mField: 10.0, // Strong field aligns to 0
  };
  const engine = new SimulationEngine(params);

  // Start at PI (unstable equilibrium)
  const N = 16;
  const theta = new Float64Array(N).fill(Math.PI - 0.1); // Slightly off
  const omega = new Float64Array(N).fill(0);

  engine.setState(theta, omega);

  engine.step(0.1);

  // Should accelerate towards 0
  // theta is positive, accel should be negative
  // accel = -M sin(theta) ~ -10 * sin(3.04) ~ -10 * 0.1 ~ -1
  // omega should become negative

  const meanOmega = engine.omega.reduce((a, b) => a + b, 0) / N;
  if (meanOmega >= 0) {
    throw new Error("Rotors did not accelerate towards field direction");
  }
});

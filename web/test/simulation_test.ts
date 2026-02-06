import { assertAlmostEquals } from "@std/assert";
import { SimulationEngine, SimulationParams } from "../src/simulation.ts";

Deno.test("Simulation Energy Conservation", async () => {
  const params: SimulationParams = {
    lSide: 10,
    jCoupling: 1.0,
    mField: 0.0,
  };
  const engine = new SimulationEngine(params);
  await engine.initialize();

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
  const diff = Math.abs(finalEnergy - initialEnergy);
  const relErr = diff / Math.abs(initialEnergy);

  console.log(`Relative Error: ${relErr}`);

  if (relErr > 1e-4) {
    throw new Error(`Energy drift too high: ${relErr}`);
  }

  assertAlmostEquals(initialEnergy, finalEnergy, 1e-2);
});

Deno.test("Order parameter for aligned and anti-aligned states", async () => {
  const params: SimulationParams = {
    lSide: 2,
    jCoupling: 0.0,
    mField: 0.0,
  };
  const engine = new SimulationEngine(params);
  await engine.initialize();

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
  // r might not be exactly 0 due to floating point, but it should be very small
  assertAlmostEquals(anti.r, 0.0, 1e-12);
});

Deno.test("Hamiltonian reduces to kinetic + field when J=0", async () => {
  const params: SimulationParams = {
    lSide: 1,
    jCoupling: 0.0,
    mField: 2.0,
  };
  const engine = new SimulationEngine(params);
  await engine.initialize();
  const theta = new Float64Array([Math.PI / 3]);
  const omega = new Float64Array([3.0]);
  engine.setState(theta, omega);

  const expected = 0.5 * 9.0 - 2.0 * Math.cos(Math.PI / 3);
  assertAlmostEquals(engine.getEnergy(), expected, 1e-5);
});

Deno.test("Field Effect", async () => {
  const params: SimulationParams = {
    lSide: 4,
    jCoupling: 0.0,
    mField: 10.0,
  };
  const engine = new SimulationEngine(params);
  await engine.initialize();

  const N = 16;
  const theta = new Float64Array(N).fill(Math.PI - 0.1);
  const omega = new Float64Array(N).fill(0);

  engine.setState(theta, omega);
  engine.step(0.1);

  const meanOmega = engine.omega.reduce((a, b) => a + b, 0) / N;
  if (meanOmega >= 0) {
    throw new Error("Rotors did not accelerate towards field direction");
  }
});

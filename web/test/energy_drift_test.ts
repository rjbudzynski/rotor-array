import { assertAlmostEquals } from "@std/assert";
import init, {
  WasmSimulationEngine,
} from "../simulation-wasm/pkg/simulation_wasm.js";

Deno.test("Energy Drift Analysis (Interpolated LUT)", async () => {
  await init();

  const L = 20;
  const J = 5.0; // Strong coupling
  const M = 0.5; // Field
  const engine = new WasmSimulationEngine(L, J, M);

  // Initialize with some non-zero state
  const N = L * L;
  const theta = new Float64Array(N);
  const omega = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    theta[i] = Math.random() * 2 * Math.PI;
    omega[i] = (Math.random() - 0.5) * 2.0;
  }
  engine.set_state(theta, omega, 0);

  const initialEnergy = engine.get_energy();
  console.log(`
Initial Energy: ${initialEnergy.toFixed(6)}`);

  const steps = 5000;
  const dt = 0.05;

  let maxRelError = 0;

  // Run long simulation
  for (let i = 0; i < steps; i++) {
    engine.step(dt);
    const currentEnergy = engine.get_energy();
    const relError = Math.abs(currentEnergy - initialEnergy) /
      Math.abs(initialEnergy);
    maxRelError = Math.max(maxRelError, relError);

    if (i % 1000 === 0 && i > 0) {
      console.log(`Step ${i}: Rel Error = ${relError.toExponential(4)}`);
    }
  }

  const finalEnergy = engine.get_energy();
  const finalRelError = Math.abs(finalEnergy - initialEnergy) /
    Math.abs(initialEnergy);

  console.log(`Final Energy:   ${finalEnergy.toFixed(6)}`);
  console.log(`Max Rel Error:   ${maxRelError.toExponential(4)}`);
  console.log(`Final Rel Error: ${finalRelError.toExponential(4)}`);

  // For a symplectic integrator with LUT interpolation, we expect error to stay bounded and small.
  // Standard Velocity Verlet usually maintains ~1e-5 to 1e-7 relative error.
  // If it's much higher, the LUT is degrading the Hamiltonian properties.
  if (maxRelError > 1e-3) {
    throw new Error(`Energy drift too high: ${maxRelError}`);
  }

  assertAlmostEquals(
    initialEnergy,
    finalEnergy,
    Math.abs(initialEnergy) * 1e-3,
  );
});

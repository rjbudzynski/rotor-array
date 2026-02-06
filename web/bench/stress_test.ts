import init, { WasmSimulationEngine } from "../simulation-wasm/pkg/simulation_wasm.js";

async function benchmark(L: number) {
    await init();
    const J = 1.0;
    const M = 0.5;
    const engine = new WasmSimulationEngine(L, J, M);
    
    const N = L * L;
    const theta = new Float64Array(N).fill(0.1);
    const omega = new Float64Array(N).fill(0.0);
    engine.set_state(theta, omega, 0);
    
    const steps = 100;
    const dt = 0.01;
    
    const start = performance.now();
    for (let i = 0; i < steps; i++) {
        engine.step(dt);
    }
    const end = performance.now();
    
    const totalTime = end - start;
    const timePerStep = totalTime / steps;
    const rotorsPerSec = (N * steps) / (totalTime / 1000);
    
    console.log(`L=${L} (${N} rotors):`);
    console.log(`  Total time for ${steps} steps: ${totalTime.toFixed(2)}ms`);
    console.log(`  Avg time per step: ${timePerStep.toFixed(3)}ms`);
    console.log(`  Throughput: ${(rotorsPerSec / 1e6).toFixed(2)} million rotors/sec`);
    
    // For 60 FPS, we need (StepTime + RenderTime) < 16.6ms.
    // Assuming RenderTime is ~2-4ms, we want StepTime < 12ms.
    return timePerStep;
}

const sizes = [200, 300, 400, 500, 600];
console.log("Rotor Array WASM Performance Benchmark\n");

for (const L of sizes) {
    await benchmark(L);
    console.log("");
}
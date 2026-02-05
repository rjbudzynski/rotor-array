import { SimulationEngine } from "../src/simulation.ts";
import { generateInitialState } from "../src/presets.ts";

interface BenchResult {
  lSide: number;
  steps: number;
  totalMs: number;
  msPerStep: number;
  stepsPerSec: number;
}

const args = new Set(Deno.args);
const warmupSteps = 20;
const stepsPerRun = 120;
const dt = 1 / 60;
const minL = 10;
const maxL = 200;
const stepL = 10;

const results: BenchResult[] = [];

function runBenchmark(lSide: number): BenchResult {
  const engine = new SimulationEngine({
    lSide,
    jCoupling: 1.0,
    mField: 0.0,
  });
  const { theta, omega } = generateInitialState(
    lSide,
    "Random Angles",
    0,
    0,
    0,
    0,
  );
  engine.setState(theta, omega);

  for (let i = 0; i < warmupSteps; i++) {
    engine.step(dt);
  }

  const start = performance.now();
  for (let i = 0; i < stepsPerRun; i++) {
    engine.step(dt);
  }
  const end = performance.now();

  const totalMs = end - start;
  const msPerStep = totalMs / stepsPerRun;
  const stepsPerSec = 1000 / msPerStep;

  return { lSide, steps: stepsPerRun, totalMs, msPerStep, stepsPerSec };
}

function format(n: number, digits = 2) {
  return n.toFixed(digits);
}

for (let l = minL; l <= maxL; l += stepL) {
  const res = runBenchmark(l);
  results.push(res);
  if (!args.has("--quiet")) {
    console.log(
      `L=${res.lSide} | ${format(res.msPerStep)} ms/step | ${format(res.stepsPerSec)} steps/s`,
    );
  }
}

let max60: number | null = null;
let max30: number | null = null;
for (const r of results) {
  if (r.stepsPerSec >= 60) max60 = r.lSide;
  if (r.stepsPerSec >= 30) max30 = r.lSide;
}

console.log("\nSummary:");
console.log(
  `60 Hz max L: ${max60 ?? "none"} | 30 Hz max L: ${max30 ?? "none"}`,
);

import { assert } from "@std/assert";
import { DOMParser } from "deno_dom";
import { ControlPanel } from "../src/ui.ts";
import { SimulationEngine } from "../src/simulation.ts";
import { generateInitialState } from "../src/presets.ts";

function setupDom(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) throw new Error("Failed to parse HTML");
  // deno-lint-ignore no-explicit-any
  (globalThis as any).document = doc;
  return doc;
}

Deno.test("ControlPanel reset can wire a simulation engine", () => {
  setupDom(`<div id="controls-container"></div>`);
  const controls = new ControlPanel("controls-container");

  let engine: SimulationEngine | null = null;
  controls.onReset = (preset, k, p2, p3, temp) => {
    const l = parseInt(controls.lInput.value) || 20;
    engine = new SimulationEngine({ lSide: l, jCoupling: 1.0, mField: 0.0 });
    const { theta, omega } = generateInitialState(l, preset, k, p2, p3, temp);
    engine.setState(theta, omega);
  };

  controls.triggerReset();
  assert(engine !== null);
});

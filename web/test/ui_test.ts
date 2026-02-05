import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "deno_dom";
import { ControlPanel, OrderPlot } from "../src/ui.ts";
import type uPlot from "uplot";

function setupDom(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) throw new Error("Failed to parse HTML");
  // deno_dom uses its own Document type; assign globally for code under test.
  // deno-lint-ignore no-explicit-any
  (globalThis as any).document = doc;
  return doc;
}

Deno.test("ControlPanel toggles inputs on start/stop", () => {
  const doc = setupDom(
    `<div id="controls-container"></div>`,
  );
  const controls = new ControlPanel("controls-container");

  assertEquals(controls.isRunning, false);
  controls.toggleRunning();
  assertEquals(controls.isRunning, true);
  assert(controls.lInput.disabled);

  controls.toggleRunning();
  assertEquals(controls.isRunning, false);
  assert(!controls.lInput.disabled);

  // Silence unused variable lint warnings in case of future changes.
  assert(doc !== null);
});

Deno.test("ControlPanel reset emits parsed values", () => {
  setupDom(`<div id="controls-container"></div>`);
  const controls = new ControlPanel("controls-container");

  controls.kInput.value = "2.5";
  controls.p2Input.value = "3.0";
  controls.p3Input.value = "0.25";
  controls.tempInput.value = "50"; // 0.5

  let captured:
    | { preset: string; k: number; p2: number; p3: number; temp: number }
    | null = null;
  controls.onReset = (preset, k, p2, p3, temp) => {
    captured = { preset, k, p2, p3, temp };
  };

  controls.triggerReset();
  if (captured === null) throw new Error("Reset callback not invoked");
  const capturedValue = captured as {
    preset: string;
    k: number;
    p2: number;
    p3: number;
    temp: number;
  };
  assertEquals(capturedValue.k, 2.5);
  assertEquals(capturedValue.p2, 3.0);
  assertEquals(capturedValue.p3, 0.25);
  assertEquals(capturedValue.temp, 0.5);
});

Deno.test("OrderPlot ring buffer caps at max points", () => {
  setupDom(`<div id="uplot-chart"></div>`);
  const el = document.getElementById("uplot-chart") as HTMLElement;
  // deno-lint-ignore no-explicit-any
  (el as any).clientWidth = 300;

  class StubPlot {
    // deno-lint-ignore no-explicit-any
    constructor(_opts: any, _data: any, _el: any) {}
    // deno-lint-ignore no-explicit-any
    setData(_data: any) {}
  }

  const plot = new OrderPlot(
    "uplot-chart",
    StubPlot as unknown as new (
      opts: unknown,
      data: [number[], number[]],
      el: HTMLElement,
    ) => { setData: (data: [number[], number[]]) => void },
  );
  for (let i = 0; i < 700; i++) {
    plot.push(i, i * 0.1);
  }

  assertEquals(plot.data[0].length, 500);
  assertEquals(plot.data[1].length, 500);
  assertEquals(plot.data[0][0], 200);
  assertEquals(plot.data[0][plot.data[0].length - 1], 699);
});

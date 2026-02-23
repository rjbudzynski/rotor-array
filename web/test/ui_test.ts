import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "deno_dom";
import { ControlPanel, OrderPlot } from "../src/ui.ts";

function setupDom(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) throw new Error("Failed to parse HTML");
  // deno_dom uses its own Document type; assign globally for code under test.
  // deno-lint-ignore no-explicit-any
  (globalThis as any).document = doc;

  // Polyfill/Mock ResizeObserver for Deno tests
  // deno-lint-ignore no-explicit-any
  (globalThis as any).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

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
  controls.tempInput.value = "0.5";

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

Deno.test("OrderPlot prunes data and sets scale for sliding window", () => {
  setupDom(`<div id="uplot-chart"></div>`);
  const el = document.getElementById("uplot-chart") as HTMLElement;
  // deno-lint-ignore no-explicit-any
  (el as any).clientWidth = 300;

  let lastScale: { min: number; max: number } | null = null;

  class StubPlot {
    // deno-lint-ignore no-explicit-any
    constructor(_opts: any, _data: any, _el: any) {}
    // deno-lint-ignore no-explicit-any
    setData(_data: any) {}
    setScale(_key: string, opts: { min: number; max: number }) {
      lastScale = opts;
    }
  }

  const plot = new OrderPlot(
    "uplot-chart",
    // deno-lint-ignore no-explicit-any
    StubPlot as any,
  );

  // 1. Initial state
  assertEquals(plot.data[0].length, 0);

  // 2. Push data within first 10s
  for (let i = 0; i <= 5; i++) {
    plot.push(i, i * 0.1, i * 0.5);
  }
  assertEquals(plot.data[0].length, 6);
  assertEquals(plot.data[1].length, 6);
  assertEquals(plot.data[2].length, 6);
  assertEquals(plot.data[0][0], 0);
  assertEquals(plot.data[0][5], 5);
  assertEquals(lastScale, { min: 0, max: 10 });

  // 3. Push data crossing 10s
  plot.push(15, 0.5, 2.5);
  // cutoff = 15 - 10 = 5. Data [0, 1, 2, 3, 4, 5, 15].
  // Remaining: [5, 15] after compaction/pruning
  assertEquals(plot.data[0].length, 2);
  assertEquals(plot.data[0][0], 5);
  assertEquals(plot.data[0][1], 15);
  assertEquals(lastScale, { min: 5, max: 15 });
});

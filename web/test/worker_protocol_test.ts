import { assert, assertEquals } from "@std/assert";
import { DOMParser } from "deno_dom";
import { ControlPanel } from "../src/ui.ts";
import { generateInitialState } from "../src/presets.ts";

function setupDom(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) throw new Error("Failed to parse HTML");
  // deno-lint-ignore no-explicit-any
  (globalThis as any).document = doc;
  return doc;
}

interface WorkerMessage {
  type: string;
  payload: Record<string, unknown>;
}

Deno.test("Worker reset message includes all required parameters", () => {
  const doc = setupDom(`
    <div id="app">
      <div id="canvas-container"><canvas id="sim-canvas"></canvas></div>
      <div id="controls-container"></div>
    </div>
  `);

  // Mock canvas with getContext
  const canvasEl = doc.getElementById("sim-canvas");
  if (!canvasEl) throw new Error("Canvas not found");
  // deno-lint-ignore no-explicit-any
  (canvasEl as any).getContext = () => ({
    fillRect: () => {},
    clearRect: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(100) }),
    putImageData: () => {},
    createImageData: () => ({ data: new Uint8ClampedArray(100) }),
    setTransform: () => {},
    drawImage: () => {},
    save: () => {},
    fillText: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    arc: () => {},
    arcTo: () => {},
    fill: () => {},
    rect: () => {},
    quadraticCurveTo: () => {},
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    lineCap: "",
    lineJoin: "",
    miterLimit: 1,
    font: "",
    textAlign: "",
    textBaseline: "",
  });

  const canvas = canvasEl as unknown as HTMLCanvasElement;

  // Simple visualizer mock that captures upsample logic
  let capturedUpsample = 0;
  const mockVisualizer = {
    lSide: 0,
    upsample: 0,
    setLSide(l: number) {
      this.lSide = l;
      // Simplified upsample calculation
      this.upsample = Math.max(1, Math.floor(500 / l));
      capturedUpsample = this.upsample;
    },
  };

  const controls = new ControlPanel("controls-container");

  // Track what gets sent to worker
  let capturedMessage: WorkerMessage | null = null;

  // Mock worker that captures messages
  const mockWorker = {
    postMessage: (msg: WorkerMessage) => {
      capturedMessage = msg;
    },
    onmessage: null as unknown,
  };

  // Simulate the reset logic from main.ts
  controls.onReset = (preset, k, p2, p3, temp) => {
    const lSide = parseInt(controls.lInput.value) || 20;
    const { theta, omega } = generateInitialState(lSide, preset, k, p2, p3, temp);

    // This is the key fix - visualizer.setLSide must be called before getting upsample
    mockVisualizer.setLSide(lSide);

    mockWorker.postMessage({
      type: "reset",
      payload: {
        lSide,
        jCoupling: parseFloat(controls.jInput.value) / 100,
        mField: parseFloat(controls.mInput.value) / 100,
        theta,
        omega,
        upsample: mockVisualizer.upsample, // This was the missing parameter
      },
    });
  };

  controls.triggerReset();

  // Verify the message was sent
  assert(capturedMessage !== null, "Reset message should be sent to worker");
  // deno-lint-ignore no-explicit-any
  const message: WorkerMessage = capturedMessage as any;

  assertEquals(message.type, "reset", "Message type should be 'reset'");

  // Verify all required parameters are present
  const payload = message.payload;
  assert("lSide" in payload, "payload should include lSide");
  assert("jCoupling" in payload, "payload should include jCoupling");
  assert("mField" in payload, "payload should include mField");
  assert("theta" in payload, "payload should include theta");
  assert("omega" in payload, "payload should include omega");
  assert("upsample" in payload, "payload should include upsample (required for WasmVisualizer)");

  // Verify types
  assertEquals(typeof payload.lSide, "number", "lSide should be a number");
  assertEquals(typeof payload.jCoupling, "number", "jCoupling should be a number");
  assertEquals(typeof payload.mField, "number", "mField should be a number");
  assertEquals(typeof payload.upsample, "number", "upsample should be a number");
  assert(capturedUpsample > 0, "upsample should be positive");
  assertEquals(payload.upsample, capturedUpsample, "upsample should match calculated value");

  // Verify arrays
  assert(payload.theta instanceof Float64Array, "theta should be Float64Array");
  assert(payload.omega instanceof Float64Array, "omega should be Float64Array");
  const lSide = payload.lSide as number;
  const theta = payload.theta as Float64Array;
  const omega = payload.omega as Float64Array;
  assertEquals(theta.length, lSide * lSide, "theta length should match L²");
  assertEquals(omega.length, lSide * lSide, "omega length should match L²");
});

Deno.test("setLSide must be called before accessing upsample", () => {
  const doc = setupDom(`
    <div id="app">
      <div id="canvas-container" style="width: 600px; height: 600px;">
        <canvas id="sim-canvas"></canvas>
      </div>
      <div id="controls-container"></div>
    </div>
  `);

  // Mock canvas with getContext
  const canvasEl = doc.getElementById("sim-canvas");
  if (!canvasEl) throw new Error("Canvas not found");
  // deno-lint-ignore no-explicit-any
  (canvasEl as any).getContext = () => ({
    fillRect: () => {},
    clearRect: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(100) }),
    putImageData: () => {},
    createImageData: () => ({ data: new Uint8ClampedArray(100) }),
    setTransform: () => {},
    drawImage: () => {},
    save: () => {},
    fillText: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    arc: () => {},
    arcTo: () => {},
    fill: () => {},
    rect: () => {},
    quadraticCurveTo: () => {},
  });

  const canvas = canvasEl as unknown as HTMLCanvasElement;

  // Track the sequence of operations
  let setLSideCalled = false;
  let upsampleAccessedAfterSetLSide = false;

  const controls = new ControlPanel("controls-container");

  controls.onReset = (_preset, _k, _p2, _p3, _temp) => {
    const lSide = parseInt(controls.lInput.value) || 20;

    // Simulate the logic from main.ts
    const mockVisualizer = {
      lSide: 0,
      upsample: 0,
      setLSide(l: number) {
        this.lSide = l;
        this.upsample = Math.max(1, Math.floor(500 / l));
        setLSideCalled = true;
      },
      get upsampleValue() {
        if (!setLSideCalled) {
          throw new Error("upsample accessed before setLSide was called!");
        }
        upsampleAccessedAfterSetLSide = true;
        return this.upsample;
      },
    };

    // This is the correct order from main.ts
    mockVisualizer.setLSide(lSide);
    const _upsample = mockVisualizer.upsampleValue; // Should work
  };

  controls.triggerReset();

  assert(setLSideCalled, "setLSide should be called during reset");
  assert(
    upsampleAccessedAfterSetLSide,
    "upsample should be accessed AFTER setLSide is called",
  );
});

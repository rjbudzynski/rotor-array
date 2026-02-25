import { assert, assertEquals } from "@std/assert";
import { SimulationManager } from "../src/simulation_manager.ts";

type PostedMessage = {
  msg: Record<string, unknown>;
  transfer: Transferable[];
};

function withMockWorker(testBody: (messages: PostedMessage[]) => void) {
  const originalWorker = globalThis.Worker;
  const messages: PostedMessage[] = [];

  // deno-lint-ignore no-explicit-any
  (globalThis as any).Worker = class MockWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    // deno-lint-ignore no-explicit-any
    constructor(_url: any, _opts: any) {}

    postMessage(msg: Record<string, unknown>, transfer?: Transferable[]) {
      messages.push({ msg, transfer: transfer ?? [] });
    }
  };

  try {
    testBody(messages);
  } finally {
    globalThis.Worker = originalWorker;
  }
}

Deno.test("SimulationManager reset message matches runtime slider semantics", () => {
  withMockWorker((messages) => {
    const manager = new SimulationManager();
    manager.reset({
      lSide: 20,
      jInput: "1.25",
      mInput: "0.50",
      theta: new Float64Array(400),
      omega: new Float64Array(400),
      upsample: 12,
      showArrows: false,
    });

    assertEquals(messages.length, 1);
    assertEquals(messages[0].msg.type, "reset");

    const payload = messages[0].msg.payload as Record<string, unknown>;
    assertEquals(payload.lSide, 20);
    assertEquals(payload.jCoupling, 1.25);
    assertEquals(payload.mField, 0.5);
    assertEquals(payload.upsample, 12);
    assertEquals(payload.showArrows, false);
    assert(payload.theta instanceof Float64Array);
    assert(payload.omega instanceof Float64Array);
  });
});

Deno.test("SimulationManager returnBuffers only posts valid buffers", () => {
  withMockWorker((messages) => {
    const manager = new SimulationManager();

    const theta = new ArrayBuffer(16);
    manager.returnBuffers(theta);
    assertEquals(messages.length, 1);
    assertEquals(messages[0].msg.type, "returnBuffers");
    const payload = messages[0].msg.payload as Record<string, unknown>;
    assert(payload.theta instanceof ArrayBuffer);
    assertEquals(messages[0].transfer.length, 1);

    manager.returnBuffers(new ArrayBuffer(0));
    assertEquals(messages.length, 1);
  });
});

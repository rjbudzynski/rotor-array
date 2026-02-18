// Removed SLIDER_SCALE import as it is no longer needed with native floating-point sliders.

export interface FramePayload {
  imageBitmap?: ImageBitmap;
  theta: ArrayBuffer;
  omega: ArrayBuffer;
  orderParameter: {
    r: number;
    meanCos: number;
    meanSin: number;
    t: number;
  };
  lSide: number;
  canvasSize: number;
  upsample: number;
}

export interface EnergyStatsPayload {
  perNode: number;
  relDev: number;
}

export type FrameSubscriber = (payload: FramePayload) => void;
export type EnergyStatsSubscriber = (payload: EnergyStatsPayload) => void;
export type InitializedSubscriber = () => void;

export class SimulationManager {
  private worker: Worker;
  private frameSubscribers: Set<FrameSubscriber> = new Set();
  private energyStatsSubscribers: Set<EnergyStatsSubscriber> = new Set();
  private initializedSubscribers: Set<InitializedSubscriber> = new Set();

  constructor() {
    this.worker = new Worker(new URL("./worker.js", import.meta.url), {
      type: "module",
    });
    this.setupWorkerListeners();
  }

  private setupWorkerListeners() {
    this.worker.onmessage = (e) => {
      const { type, payload } = e.data;

      switch (type) {
        case "initialized":
          this.initializedSubscribers.forEach((sub) => sub());
          break;
        case "frame":
          this.frameSubscribers.forEach((sub) => sub(payload as FramePayload));
          break;
        case "energyStats":
          this.energyStatsSubscribers.forEach((sub) => sub(payload as EnergyStatsPayload));
          break;
      }
    };
  }

  public init() {
    this.worker.postMessage({ type: "init" });
  }

  public reset(params: {
    lSide: number;
    jInput: string;
    mInput: string;
    theta: Float64Array;
    omega: Float64Array;
    upsample: number;
    showArrows: boolean;
  }) {
    this.worker.postMessage({
      type: "reset",
      payload: {
        lSide: params.lSide,
        jCoupling: parseFloat(params.jInput),
        mField: parseFloat(params.mInput),
        theta: params.theta,
        omega: params.omega,
        upsample: params.upsample,
        showArrows: params.showArrows,
      },
    });
  }

  public start() {
    this.worker.postMessage({ type: "start" });
  }

  public stop() {
    this.worker.postMessage({ type: "stop" });
  }

  public updateParams(j: number, m: number, t: number) {
    this.worker.postMessage({ type: "updateParams", payload: { j, m, t } });
  }

  public setRenderOptions(showArrows: boolean) {
    this.worker.postMessage({
      type: "setRenderOptions",
      payload: { showArrows },
    });
  }

  public updateUpsample(upsample: number) {
    this.worker.postMessage({
      type: "updateUpsample",
      payload: { upsample },
    });
  }

  public setRenderMode(mode: "webgl2" | "canvas2d") {
    this.worker.postMessage({
      type: "setRenderMode",
      payload: { mode },
    });
  }

  public returnBuffers(theta?: ArrayBuffer, omega?: ArrayBuffer) {
    const transfer: Transferable[] = [];
    const payload: { theta?: ArrayBuffer; omega?: ArrayBuffer } = {};

    // Only return buffers that are valid (have content and haven't been detached)
    // Detached buffers have byteLength === 0 after being transferred
    if (theta && theta.byteLength > 0) {
      payload.theta = theta;
      transfer.push(theta);
    }
    if (omega && omega.byteLength > 0) {
      payload.omega = omega;
      transfer.push(omega);
    }

    if (transfer.length > 0) {
      this.worker.postMessage({ type: "returnBuffers", payload }, transfer);
    }
  }

  public requestFrame() {
    this.worker.postMessage({ type: "requestFrame" });
  }

  public onInitialized(sub: InitializedSubscriber) {
    this.initializedSubscribers.add(sub);
    return () => this.initializedSubscribers.delete(sub);
  }

  public onFrame(sub: FrameSubscriber) {
    this.frameSubscribers.add(sub);
    return () => this.frameSubscribers.delete(sub);
  }

  public onEnergyStats(sub: EnergyStatsSubscriber) {
    this.energyStatsSubscribers.add(sub);
    return () => this.energyStatsSubscribers.delete(sub);
  }
}

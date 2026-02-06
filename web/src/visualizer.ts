import { getLutColor } from "./colors.ts";

export class RotorArrayVisualizer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  lSide: number = 0;
  upsample: number = 0;

  private _imageData: ImageData | null = null;
  private _mask: Uint8Array | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // willReadFrequently is not needed for putImageData, but good for stability
    const ctx = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
    });
    if (!ctx) throw new Error("No 2D Context");
    this.ctx = ctx;
  }

  setLSide(l: number) {
    const container = this.canvas.parentElement;
    const width = container ? container.clientWidth - 40 : 600;
    const height = container ? container.clientHeight - 40 : 600;
    const size = Math.max(100, Math.min(width, height));

    // Choose an upsample that makes rotors at least 1 pixel
    const newUpsample = Math.max(1, Math.floor(size / l));
    const actualSize = l * newUpsample;

    // Fix: Force consistent display size regardless of internal resolution jump
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;

    if (
      this.lSide !== l ||
      this.upsample !== newUpsample ||
      this.canvas.width !== actualSize
    ) {
      this.lSide = l;
      this.upsample = newUpsample;
      this.canvas.width = actualSize;
      this.canvas.height = actualSize;
      this.updateBuffers();
    }
  }

  private updateBuffers() {
    const size = this.lSide * this.upsample;
    this._imageData = new ImageData(size, size);

    const S = this.upsample;
    // High LOD: Use anti-aliased disc mask for large enough upsamples
    if (S >= 4) {
      this._mask = new Uint8Array(S * S);
      const center = (S - 1) / 2.0;
      const radius = 0.45 * S;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const dist = Math.sqrt((x - center) ** 2 + (y - center) ** 2);
          let a = 0;
          if (dist < radius - 0.5) a = 255;
          else if (dist < radius + 0.5) {
            a = Math.floor(255 * (radius + 0.5 - dist));
          }
          this._mask[y * S + x] = a;
        }
      }
    } else {
      this._mask = null;
    }
  }

  update(theta: Float64Array, omega: Float64Array, showArrows: boolean) {
    if (!this._imageData) return;

    const L = this.lSide;
    const S = this.upsample;
    const data = this._imageData.data;
    const totalW = L * S;
    const mask = this._mask;

    // Fast opaque black clear
    new Uint32Array(data.buffer).fill(0xFF000000);

    const color = new Uint8Array(3);

    for (let r = 0; r < L; r++) {
      const startY = r * S;
      for (let c = 0; c < L; c++) {
        const idx = r * L + c;
        const startX = c * S;

        getLutColor(theta[idx], omega[idx] ** 2, color, 0);
        const rInt = color[0];
        const gInt = color[1];
        const bInt = color[2];

        if (mask) {
          // High LOD path
          for (let my = 0; my < S; my++) {
            const rowIdx = (startY + my) * totalW * 4;
            const mRowIdx = my * S;
            for (let mx = 0; mx < S; mx++) {
              const alpha = mask[mRowIdx + mx];
              if (alpha === 0) continue;
              const pIdx = rowIdx + (startX + mx) * 4;
              data[pIdx] = rInt;
              data[pIdx + 1] = gInt;
              data[pIdx + 2] = bInt;
              data[pIdx + 3] = alpha;
            }
          }
        } else {
          // Low LOD / Pixel path
          for (let my = 0; my < S; my++) {
            const rowIdx = (startY + my) * totalW * 4;
            for (let mx = 0; mx < S; mx++) {
              const pIdx = rowIdx + (startX + mx) * 4;
              data[pIdx] = rInt;
              data[pIdx + 1] = gInt;
              data[pIdx + 2] = bInt;
              data[pIdx + 3] = 255;
            }
          }
        }
      }
    }

    this.ctx.putImageData(this._imageData, 0, 0);

    if (showArrows && L <= 60) {
      this.drawArrows(theta);
    }
  }

  private drawArrows(theta: Float64Array) {
    const L = this.lSide;
    const S = this.upsample;
    const ctx = this.ctx;
    const centerOffset = (S - 1) / 2.0;
    const arrowLen = 0.45 * S;

    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = Math.max(1, S / 10);
    ctx.lineCap = "round";
    ctx.beginPath();

    for (let r = 0; r < L; r++) {
      for (let c = 0; c < L; c++) {
        const idx = r * L + c;
        const th = theta[idx];
        const cx = c * S + centerOffset;
        const cy = r * S + centerOffset;
        const ex = cx + arrowLen * Math.sin(th);
        const ey = cy + arrowLen * Math.cos(th);
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
      }
    }
    ctx.stroke();
  }
}

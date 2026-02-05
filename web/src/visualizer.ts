import { getLutColor } from "./colors.ts";

export class RotorArrayVisualizer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  lSide: number = 0;

  imageData: ImageData | null = null;
  mask: Uint8Array | null = null;
  upsample: number = 0;
  private containerWidth: number = 0;
  private containerHeight: number = 0;
  private sizeDirty: boolean = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", {
      alpha: true,
      willReadFrequently: true,
    });
    if (!ctx) throw new Error("No 2D Context");
    this.ctx = ctx;

    const container = this.canvas.parentElement;
    if (container && "ResizeObserver" in window) {
      const observer = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (!rect) return;
        this.containerWidth = rect.width;
        this.containerHeight = rect.height;
        this.sizeDirty = true;
      });
      observer.observe(container);
      const rect = container.getBoundingClientRect();
      this.containerWidth = rect.width;
      this.containerHeight = rect.height;
    }
  }

  setLSide(l: number) {
    if (!this.sizeDirty && this.lSide === l) return;

    // Find best size using cached container dimensions
    const width = (this.containerWidth || 600) - 40;
    const height = (this.containerHeight || 600) - 40;
    const size = Math.max(100, Math.min(width, height));

    const newUpsample = Math.max(1, Math.floor(size / l));
    const actualSize = l * newUpsample;

    if (
      this.lSide !== l || this.upsample !== newUpsample ||
      this.canvas.width !== actualSize || this.sizeDirty
    ) {
      this.lSide = l;
      this.upsample = newUpsample;
      this.canvas.width = actualSize;
      this.canvas.height = actualSize;
      this.updateBuffers();
      this.sizeDirty = false;
    }
  }

  updateBuffers() {
    if (this.upsample <= 0) return;

    const size = this.lSide * this.upsample;
    this.imageData = new ImageData(size, size);

    const S = this.upsample;
    // High LOD: only compute mask if discs are large enough
    if (S >= 4) {
      this.mask = new Uint8Array(S * S);
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
          this.mask[y * S + x] = a;
        }
      }
    } else {
      this.mask = null;
    }
  }

  update(theta: Float64Array, omega: Float64Array, showArrows: boolean) {
    if (!this.imageData || this.upsample <= 0) return;

    const L = this.lSide;
    const S = this.upsample;
    const data = this.imageData.data;
    const totalW = L * S;
    const mask = this.mask;

    // Clear background to black opaque
    new Uint32Array(data.buffer).fill(0xFF000000);

    const color = new Uint8Array(3);

    for (let r = 0; r < L; r++) {
      const startY = r * S;
      for (let c = 0; c < L; c++) {
        const idx = r * L + c;
        const startX = c * S;

        // Fast LUT lookup
        getLutColor(theta[idx], omega[idx] ** 2, color, 0);
        const rInt = color[0];
        const gInt = color[1];
        const bInt = color[2];

        if (mask) {
          // High LOD: use mask
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
          // Low LOD: fill square
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

    this.ctx.putImageData(this.imageData, 0, 0);

    if (showArrows && L <= 60) {
      this.drawArrows(theta);
    }
  }

  drawArrows(theta: Float64Array) {
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

import { thetaToHue, omegaToValue } from "./colors.ts";

export class RotorArrayVisualizer {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    lSide: number = 0;
    
    imageData: ImageData | null = null;
    mask: Uint8Array | null = null;
    upsample: number = 0;
    
    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) throw new Error("No 2D Context");
        this.ctx = ctx;
    }
    
    setLSide(l: number) {
        // Find best size
        const container = this.canvas.parentElement;
        let width = container ? container.clientWidth - 40 : 600;
        let height = container ? container.clientHeight - 40 : 600;
        
        const size = Math.max(100, Math.min(width, height));
        
        const newUpsample = Math.max(1, Math.floor(size / l));
        const actualSize = l * newUpsample;

        if (this.lSide !== l || this.upsample !== newUpsample || this.canvas.width !== actualSize) {
            this.lSide = l;
            this.upsample = newUpsample;
            this.canvas.width = actualSize;
            this.canvas.height = actualSize;
            this.updateBuffers();
        }
    }
    
    updateBuffers() {
        if (this.upsample <= 0) return;
        
        const size = this.lSide * this.upsample;
        this.imageData = new ImageData(size, size);
        
        const S = this.upsample;
        this.mask = new Uint8Array(S * S);
        const center = (S - 1) / 2.0;
        const radius = 0.45 * S;
        
        for(let y=0; y<S; y++) {
            for(let x=0; x<S; x++) {
                const dist = Math.sqrt((x-center)**2 + (y-center)**2);
                let a = 0;
                if (dist < radius - 0.5) a = 255;
                else if (dist < radius + 0.5) a = Math.floor(255 * (radius + 0.5 - dist));
                this.mask[y*S + x] = a;
            }
        }
    }
    
    update(theta: Float64Array, omega: Float64Array, showArrows: boolean) {
        if (!this.imageData || !this.mask || this.upsample <= 0) return;
        
        const L = this.lSide;
        const S = this.upsample;
        const data = this.imageData.data;
        const mask = this.mask;
        const totalW = L * S;
        
        // Clear background to black opaque
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 0;
            data[i+1] = 0;
            data[i+2] = 0;
            data[i+3] = 255;
        }
        
        for(let r=0; r<L; r++) {
            for(let c=0; c<L; c++) {
                const idx = r * L + c;
                const th = theta[idx];
                const om = omega[idx];
                
                const hue = thetaToHue(th);
                const val = omegaToValue(om * om);
                
                // HSV to RGB inline
                const h = hue;
                const v = val;
                
                const i = Math.floor(h * 6);
                const f = h * 6 - i;
                const q = v * (1 - f);
                const t = v * f;
                
                let rr=0, gg=0, bb=0;
                const ii = i % 6;
                switch(ii) {
                    case 0: rr=v; gg=t; bb=0; break;
                    case 1: rr=q; gg=v; bb=0; break;
                    case 2: rr=0; gg=v; bb=t; break;
                    case 3: rr=0; gg=q; bb=v; break;
                    case 4: rr=t; gg=0; bb=v; break;
                    case 5: rr=v; gg=0; bb=q; break;
                }
                
                const rInt = Math.floor(rr * 255);
                const gInt = Math.floor(gg * 255);
                const bInt = Math.floor(bb * 255);
                
                const startY = r * S;
                const startX = c * S;
                
                for(let my=0; my<S; my++) {
                    const rowIdx = (startY + my) * totalW * 4;
                    const mRowIdx = my * S;
                    for(let mx=0; mx<S; mx++) {
                        const alpha = mask[mRowIdx + mx];
                        if (alpha === 0) continue;
                        
                        const pIdx = rowIdx + (startX + mx) * 4;
                        data[pIdx] = rInt;
                        data[pIdx+1] = gInt;
                        data[pIdx+2] = bInt;
                        data[pIdx+3] = alpha; 
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
        
        for(let r=0; r<L; r++) {
            for(let c=0; c<L; c++) {
                const idx = r * L + c;
                const th = theta[idx];
                
                const cx = c * S + centerOffset;
                const cy = r * S + centerOffset;
                
                const ex = cx + arrowLen * Math.sin(th);
                const ey = cy - arrowLen * Math.cos(th);
                
                ctx.moveTo(cx, cy);
                ctx.lineTo(ex, ey);
            }
        }
        ctx.stroke();
    }
}

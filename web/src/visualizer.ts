import init, { WasmVisualizer } from "../simulation-wasm/pkg/simulation_wasm.js";

export class RotorArrayVisualizer {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    lSide: number = 0;
    upsample: number = 0;
    
    wasm: WasmVisualizer | null = null;
    wasm_exports: any = null;
    private _imageData: ImageData | null = null;
    
    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
        if (!ctx) throw new Error("No 2D Context");
        this.ctx = ctx;
    }

    async initialize(lSide: number, upsample: number) {
        this.wasm_exports = await init();
        this.wasm = new WasmVisualizer(lSide, upsample);
        this.lSide = lSide;
        this.upsample = upsample;
        this.updateImageData();
    }
    
    private updateImageData() {
        if (!this.wasm || !this.wasm_exports) return;
        const size = this.lSide * this.upsample;
        const memory = this.wasm_exports.memory.buffer;
        const rgbaPtr = this.wasm.get_rgba_ptr();
        const rgbaSize = this.wasm.get_rgba_size();
        
        const rgbaView = new Uint8ClampedArray(memory, rgbaPtr, rgbaSize);
        this._imageData = new ImageData(rgbaView, size, size);
    }

    setLSide(l: number) {
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
            
            if (this.wasm) {
                this.wasm.set_dimensions(l, newUpsample);
                this.updateImageData();
            }
        }
    }
    
    update(thetaPtr: number, omegaPtr: number, theta: Float64Array, showArrows: boolean) {
        if (!this.wasm || !this.wasm_exports) return;
        
        // Ensure ImageData is fresh and matches current WASM memory
        const memory = this.wasm_exports.memory.buffer;
        if (!this._imageData || (this._imageData.data as any).buffer.byteLength === 0 || (this._imageData.data as any).buffer !== memory) {
            this.updateImageData();
        }
        
        if (!this._imageData) return;
        
        // WASM update
        this.wasm.update(thetaPtr, omegaPtr, this.lSide * this.lSide);
        
        // Render to canvas
        this.ctx.putImageData(this._imageData, 0, 0);
        
        if (showArrows && this.lSide <= 60) {
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
        
        for(let r=0; r<L; r++) {
            for(let c=0; c<L; c++) {
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

import {
  ColorBarVisualizer,
  ControlPanel,
  MeanDirectionVisualizer,
  OrderPlot,
} from "./ui.ts";
import { generateInitialState } from "./presets.ts";
import {
  CANVAS_PADDING,
  DEFAULT_LATTICE_SIZE,
  UI_UPDATE_INTERVAL_MS,
} from "./constants.ts";
import { WebGLRenderer } from "./webgl_renderer.ts";
import { FramePayload, SimulationManager } from "./simulation_manager.ts";

const STORAGE_KEY = "rotorArrayParams";

class App {
  private canvas = document.getElementById("sim-canvas") as HTMLCanvasElement;
  private webglCanvas = document.getElementById("webgl-canvas") as HTMLCanvasElement;
  private overlayCanvas = document.getElementById("overlay-canvas") as HTMLCanvasElement;
  private mdCanvas = document.getElementById("mean-dir-canvas") as HTMLCanvasElement;
  
  private renderer: WebGLRenderer;
  private simManager: SimulationManager;
  private useWebGL2Rendering = false;
  
  private mdViz: MeanDirectionVisualizer;
  private plot: OrderPlot;
  private controls: ControlPanel;
  
  private bitmapCtx: ImageBitmapRenderingContext | null;
  private ctx2d: CanvasRenderingContext2D | null;
  private overlayCtx: CanvasRenderingContext2D;
  
  private energyPerNodeEl = document.getElementById("energy-per-node-value");
  private energyRelDevEl = document.getElementById("energy-rel-dev-value");
  private webglStatusEl: HTMLElement;
  
  private lastUiUpdate = 0;
  private displaySize = 0;
  private frameCount = 0;

  constructor() {
    this.renderer = new WebGLRenderer(this.webglCanvas);
    this.simManager = new SimulationManager();
    
    this.bitmapCtx = this.canvas.getContext("bitmaprenderer");
    this.ctx2d = this.bitmapCtx ? null : this.canvas.getContext("2d");
    
    const overlayCtx = this.overlayCanvas.getContext("2d");
    if (!overlayCtx) throw new Error("Failed to get overlay canvas context");
    this.overlayCtx = overlayCtx;
    
    this.mdViz = new MeanDirectionVisualizer(this.mdCanvas);
    this.plot = new OrderPlot("uplot-chart");
    this.controls = new ControlPanel("controls-container");
    new ColorBarVisualizer("color-bar-container");
    
    this.webglStatusEl = this.createStatusIndicator();
    
    this.setupListeners();
    this.setupResizeObserver();
    this.init();
  }

  private setupResizeObserver() {
    const container = document.getElementById("canvas-container");
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const size = Math.max(100, Math.min(width, height));
        
        if (size !== this.displaySize) {
          this.displaySize = size;
          const stack = document.getElementById("canvas-stack");
          if (stack) {
            stack.style.width = `${size}px`;
            stack.style.height = `${size}px`;
          }
          
          // Trigger a re-calculation of upsample without full reset
          const lSide = parseInt(this.controls.lInput.value) || DEFAULT_LATTICE_SIZE;
          const upsample = Math.max(1, Math.floor(this.displaySize / lSide));
          this.simManager.updateUpsample(upsample);
        }
      }
    });
    observer.observe(container);
  }

  private createStatusIndicator(): HTMLElement {
    const el = document.createElement("div");
    el.id = "webgl-status";
    el.style.cssText =
      "position:fixed;top:10px;left:10px;padding:8px 12px;border-radius:4px;font-family:monospace;font-size:12px;z-index:9999;transition:all 0.3s;cursor:pointer;";
    el.title = "Click to toggle WebGL2 rendering";
    document.body.appendChild(el);
    
    el.addEventListener("click", () => this.toggleRenderMode());
    
    return el;
  }

  private setStatus(msg: string, color: string) {
    this.webglStatusEl.textContent = msg;
    this.webglStatusEl.style.background = color;
    this.webglStatusEl.style.color = color === "#ffeb3b" ? "#000" : "#fff";
    console.log(`[RotorArray] Status: ${msg}`);
  }

  private init() {
    this.setStatus("initializing...", "#2196f3");
    
    try {
      if (this.renderer.init()) {
        this.useWebGL2Rendering = true;
        this.canvas.style.display = "none";
        this.webglCanvas.style.display = "block";
        this.setStatus("WebGL2", "#4caf50");
      } else {
        this.setStatus("Canvas2D", "#ff9800");
      }
    } catch (err) {
      console.error("[RotorArray] WebGL2 initialization failed:", err);
      this.setStatus(
        `error: ${err instanceof Error ? err.message : String(err)}`,
        "#f44336",
      );
    }

    setTimeout(() => {
      this.webglStatusEl.style.opacity = "0.5";
    }, 5000);

    this.loadParameters();
    this.simManager.init();
    
    setTimeout(() => {
      this.controls.triggerReset();
    }, 200);
  }

  private setupListeners() {
    this.simManager.onInitialized(() => {
      this.simManager.setRenderMode(this.useWebGL2Rendering ? "webgl2" : "canvas2d");
    });

    this.simManager.onFrame((payload) => this.handleFrame(payload));
    
    this.simManager.onEnergyStats((payload) => {
      if (this.energyPerNodeEl) {
        this.energyPerNodeEl.textContent = this.formatNumber(payload.perNode);
      }
      if (this.energyRelDevEl) {
        this.energyRelDevEl.textContent = this.formatRelDeviation(payload.relDev);
      }
    });

    this.controls.onReset = (preset, k, p2, p3, temp) => this.handleReset(preset, k, p2, p3, temp);
    this.controls.onParamChange = (j, m, t) => this.simManager.updateParams(j, m, t);
    this.controls.onArrowChange = (show) => this.simManager.setRenderOptions(show);
    this.controls.onStartStop = (running) => running ? this.simManager.start() : this.simManager.stop();

    // Help Dialog
    const helpBtn = document.getElementById("help-btn");
    const helpOverlay = document.getElementById("help-overlay");
    const closeHelp = document.getElementById("close-help");

    helpBtn?.addEventListener("click", () => {
      if (helpOverlay) helpOverlay.style.display = "flex";
    });
    closeHelp?.addEventListener("click", () => {
      if (helpOverlay) helpOverlay.style.display = "none";
    });
    helpOverlay?.addEventListener("click", (e) => {
      if (e.target === helpOverlay) helpOverlay.style.display = "none";
    });

    // Persistence
    globalThis.addEventListener("beforeunload", () => this.saveParameters());
    const inputs = [
      this.controls.jInput, this.controls.mInput, this.controls.timeInput,
      this.controls.tempInput, this.controls.lInput, this.controls.presetSelect,
      this.controls.arrowCheck
    ];
    inputs.forEach(input => input.addEventListener("change", () => this.saveParameters()));
  }

  private handleFrame(payload: FramePayload) {
    try {
      const {
        imageBitmap, theta: thetaBuf, omega: omegaBuf,
        orderParameter, lSide, canvasSize, upsample,
      } = payload;

      // Resize canvases if needed
      if (this.canvas.width !== canvasSize || this.canvas.height !== canvasSize) {
        this.canvas.width = canvasSize;
        this.canvas.height = canvasSize;
        this.overlayCanvas.width = canvasSize;
        this.overlayCanvas.height = canvasSize;
        this.webglCanvas.width = canvasSize;
        this.webglCanvas.height = canvasSize;
        
        // Canvas resize destroys the 2D context - must recreate it
        this.bitmapCtx = this.canvas.getContext("bitmaprenderer");
        this.ctx2d = this.bitmapCtx ? null : this.canvas.getContext("2d");
      }

      // Only update WebGL textures in WebGL mode and with valid buffers
      if (this.useWebGL2Rendering && thetaBuf && omegaBuf) {
        try {
          // Check if buffers are detached (byteLength === 0 after transfer)
          if (thetaBuf.byteLength > 0 && omegaBuf.byteLength > 0) {
            this.renderer.updateTextures(lSide, new Float32Array(thetaBuf), new Float32Array(omegaBuf));
          }
        } catch (e) {
          console.error("Error updating WebGL textures:", e);
        }
      }

      if (this.useWebGL2Rendering) {
        try {
          this.renderer.render(lSide, upsample, this.controls.arrowCheck.checked);
        } catch (e) {
          console.error("Error in WebGL render:", e);
        }
        imageBitmap?.close();
      } else if (imageBitmap) {
        this.frameCount++;
        try {
          console.log(`[Canvas2D] Frame #${this.frameCount}: bitmapCtx=${!!this.bitmapCtx}, ctx2d=${!!this.ctx2d}, imageBitmap ${imageBitmap.width}x${imageBitmap.height}`);
          if (this.bitmapCtx) {
            console.log("[Canvas2D] Calling transferFromImageBitmap...");
            this.bitmapCtx.transferFromImageBitmap(imageBitmap);
            console.log("[Canvas2D] transferFromImageBitmap succeeded");
          } else if (this.ctx2d) {
            console.log("[Canvas2D] Calling drawImage...");
            this.ctx2d.drawImage(imageBitmap, 0, 0);
            console.log("[Canvas2D] drawImage succeeded");
          } else {
            console.error("[Canvas2D] No rendering context available!");
          }
        } catch (e) {
          console.error("[Canvas2D] Error in render:", e);
          console.error("[Canvas2D] Error stack:", (e as Error).stack);
        }
        try {
          imageBitmap.close();
          console.log("[Canvas2D] Frame render complete, imageBitmap closed");
        } catch (e) {
          console.error("[Canvas2D] Error closing imageBitmap:", e);
        }
      } else {
        console.log("[Canvas2D] No imageBitmap to render");
      }
      
      console.log(`[Canvas2D] Canvas state after render: ${this.canvas.width}x${this.canvas.height}, display=${this.canvas.style.display}, parent=${this.canvas.parentElement?.id}`);
      
      // Debug: check if canvas is actually in DOM and visible
      const rect = this.canvas.getBoundingClientRect();
      console.log(`[Canvas2D] Canvas bounds: ${rect.width}x${rect.height} at (${rect.left},${rect.top}), visible=${rect.width > 0 && rect.height > 0}`);

      this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

      if (!this.useWebGL2Rendering && this.controls.arrowCheck.checked && thetaBuf && upsample >= 4 && lSide <= 60) {
        try {
          // Check buffer is valid before creating Float32Array
          if (thetaBuf.byteLength > 0) {
            this.drawArrows(this.overlayCtx, new Float32Array(thetaBuf), lSide, upsample);
          }
        } catch (e) {
          console.error("Error drawing arrows:", e);
        }
      }

      // Return buffers to worker for recycling after all rendering is done
      this.simManager.returnBuffers(thetaBuf, omegaBuf);

      const now = performance.now();
      if (now - this.lastUiUpdate > UI_UPDATE_INTERVAL_MS) {
        try {
          this.plot.push(orderParameter.t, orderParameter.r);
          this.mdViz.update(orderParameter.r, orderParameter.meanCos, orderParameter.meanSin);
        } catch (e) {
          console.error("Error updating UI:", e);
        }
        this.lastUiUpdate = now;
      }
    } catch (e) {
      console.error("Critical error in handleFrame:", e);
    }
  }

  private handleReset(_preset: string, _k: number, _p2: number, _p3: number, temp: number) {
    const lSide = parseInt(this.controls.lInput.value) || DEFAULT_LATTICE_SIZE;
    const { theta, omega } = generateInitialState(
      lSide, this.controls.presetSelect.value, 
      parseFloat(this.controls.kInput.value), 
      parseFloat(this.controls.p2Input.value), 
      parseFloat(this.controls.p3Input.value), 
      temp
    );

    const container = this.canvas.parentElement;
    const width = container ? container.clientWidth - CANVAS_PADDING : 600;
    const height = container ? container.clientHeight - CANVAS_PADDING : 600;
    const size = Math.max(100, Math.min(width, height));
    const upsample = Math.max(1, Math.floor(size / lSide));
    this.displaySize = size;

    this.simManager.reset({
      lSide,
      jInput: this.controls.jInput.value,
      mInput: this.controls.mInput.value,
      theta,
      omega,
      upsample,
      showArrows: this.controls.arrowCheck.checked,
    });

    this.plot.reset();
    this.controls.isRunning = false;
    this.controls.startBtn.textContent = "Start";
    this.controls.startBtn.classList.remove("active");
    this.controls.toggleInputs(true);
  }

  private toggleRenderMode() {
    const newMode = !this.useWebGL2Rendering;
    
    if (newMode) {
      // Switching TO WebGL2: need to recreate canvas and renderer
      this.canvas.style.display = "none";
      
      // Create a fresh canvas element to avoid context issues
      const newCanvas = document.createElement("canvas");
      newCanvas.id = "webgl-canvas";
      newCanvas.className = "sim-layer";
      newCanvas.width = this.canvas.width;
      newCanvas.height = this.canvas.height;
      newCanvas.style.width = this.canvas.style.width;
      newCanvas.style.height = this.canvas.style.height;
      newCanvas.style.display = "block";
      
      // Append to canvas-stack (sim-canvas and overlay-canvas are already there)
      const canvasStack = document.getElementById("canvas-stack");
      if (canvasStack) {
        // Insert after sim-canvas (before overlay-canvas)
        const simCanvas = document.getElementById("sim-canvas");
        if (simCanvas && simCanvas.nextSibling) {
          canvasStack.insertBefore(newCanvas, simCanvas.nextSibling);
        } else {
          canvasStack.appendChild(newCanvas);
        }
      }
      
      // Update references
      this.webglCanvas = newCanvas;
      this.renderer = new WebGLRenderer(this.webglCanvas);
      
      // Initialize fresh WebGL context
      const success = this.renderer.init();
      if (!success) {
        console.error("Failed to initialize WebGL2 context");
        alert("Failed to initialize WebGL2. The browser may be out of GPU memory. Please reload the page and try again.");
        // Revert the display changes since WebGL failed
        this.canvas.style.display = "block";
        this.webglCanvas.style.display = "none";
        return; // Don't switch modes
      }
      
      this.useWebGL2Rendering = true;
      this.setStatus("WebGL2", "#4caf50");
    } else {
      // Switching TO Canvas2D: destroy WebGL and remove canvas
      this.canvas.style.display = "block";
      this.useWebGL2Rendering = false;
      this.setStatus("Canvas2D", "#2196f3");
      
      console.log("[Mode Switch] Destroying WebGL renderer...");
      // Destroy and remove the WebGL canvas to free GPU resources
      if (this.renderer.isInitialized()) {
        this.renderer.destroy();
      }
      
      console.log("[Mode Switch] Removing WebGL canvas from DOM...");
      // Remove canvas from DOM to fully release GPU resources
      if (this.webglCanvas.parentNode) {
        this.webglCanvas.parentNode.removeChild(this.webglCanvas);
      }
      
      console.log("[Mode Switch] Initializing Canvas2D contexts...");
      // Ensure 2D contexts are initialized for Canvas2D rendering
      this.bitmapCtx = this.canvas.getContext("bitmaprenderer");
      this.ctx2d = this.bitmapCtx ? null : this.canvas.getContext("2d");
      
      console.log(`[Mode Switch] Canvas2D context ready: bitmapCtx=${!!this.bitmapCtx}, ctx2d=${!!this.ctx2d}`);
      console.log(`[Mode Switch] Canvas dimensions: ${this.canvas.width}x${this.canvas.height}`);
      
      // Clear the canvas to ensure clean state
      if (this.bitmapCtx) {
        // Bitmap context doesn't need clearing, but ensure canvas is ready
      } else if (this.ctx2d) {
        this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
      
      // Force a reflow/repaint to ensure canvas is properly composited (Linux fix)
      this.canvas.style.transform = "translateZ(0)";
      void this.canvas.offsetHeight; // Force reflow
      console.log("[Mode Switch] Forced canvas reflow for Linux compositing");
    }
    
    this.simManager.setRenderMode(this.useWebGL2Rendering ? "webgl2" : "canvas2d");
    this.simManager.requestFrame();
  }

  private drawArrows(ctx: CanvasRenderingContext2D, theta: Float32Array, lSide: number, upsample: number) {
    const L = lSide;
    const S = upsample;
    const centerOffset = (S - 1) / 2.0;
    
    // Scale factor to match the [-0.5, 0.5] range of WebGL geometry into pixel space
    const scale = S;

    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";

    for (let r = 0; r < L; r++) {
      for (let c = 0; c < L; c++) {
        const idx = r * L + c;
        const th = theta[idx];
        const cx = c * S + centerOffset;
        const cy = r * S + centerOffset;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-th); // CCW rotation parity
        ctx.scale(scale, scale);
        
        // Ensure line width is exactly 1 pixel in screen space (or 0.5 unit if scale=1)
        ctx.lineWidth = 0.5 / scale;

        // Draw shaft (rectangle from -0.03, -0.45 to 0.03, 0.15)
        ctx.beginPath();
        ctx.rect(-0.03, -0.45, 0.06, 0.6);
        ctx.fill();
        ctx.stroke();

        // Draw head (triangle from -0.12, 0.15 to 0.12, 0.15 to 0, 0.45)
        ctx.beginPath();
        ctx.moveTo(-0.12, 0.15);
        ctx.lineTo(0.12, 0.15);
        ctx.lineTo(0, 0.45);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
      }
    }
  }

  private formatNumber(value: number): string {
    if (!Number.isFinite(value)) return "—";
    const absValue = Math.abs(value);
    if (absValue >= 0.01 && absValue < 1000) return value.toFixed(4);
    return value.toExponential(3);
  }

  private formatRelDeviation(value: number): string {
    if (!Number.isFinite(value)) return "—";
    return value.toExponential(1);
  }

  private saveParameters() {
    try {
      const params = {
        lSide: this.controls.lInput.value,
        preset: this.controls.presetSelect.value,
        j: this.controls.jInput.value,
        m: this.controls.mInput.value,
        timeScale: this.controls.timeInput.value,
        temp: this.controls.tempInput.value,
        showArrows: this.controls.arrowCheck.checked,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
    } catch { /* ignore */ }
  }

  private loadParameters() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const params = JSON.parse(saved);
        if (params.lSide) this.controls.lInput.value = params.lSide;
        if (params.preset) this.controls.presetSelect.value = params.preset;
        if (params.j) {
          let val = parseFloat(params.j);
          if (val > 20) val /= 100; // Migration from old 0-2000 range
          this.controls.jInput.value = val.toString();
          this.controls.jInput.dispatchEvent(new Event("input"));
        }
        if (params.m) {
          let val = parseFloat(params.m);
          if (val > 10) val /= 100; // Migration from old 0-1000 range
          this.controls.mInput.value = val.toString();
          this.controls.mInput.dispatchEvent(new Event("input"));
        }
        if (params.timeScale) {
          let val = parseFloat(params.timeScale);
          if (val > 10) val /= 100; // Migration from old 10-500 range
          this.controls.timeInput.value = val.toString();
          this.controls.timeInput.dispatchEvent(new Event("input"));
        }
        if (params.temp) {
          let val = parseFloat(params.temp);
          if (val > 2) val /= 100; // Migration from old 0-200 range
          this.controls.tempInput.value = val.toString();
          this.controls.tempInput.dispatchEvent(new Event("input"));
        }
        if (params.showArrows !== undefined) this.controls.arrowCheck.checked = params.showArrows;
        this.controls.updatePresetUI();
      }
    } catch { /* ignore */ }
  }
}

// Start the application
new App();

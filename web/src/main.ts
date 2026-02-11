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
  SLIDER_SCALE,
  UI_UPDATE_INTERVAL_MS,
} from "./constants.ts";
import {
  bindRotorStateTextures as _bindRotorStateTextures,
  checkWebGL2Support,
  createFullScreenQuad,
  createRotorStateTextures,
  createShaderProgram,
  deleteRotorStateTextures,
  initWebGL2,
  resizeCanvasToDisplaySize,
  setupContextHandlers,
  updateRotorStateTextures,
  type RotorStateTextures,
  type ShaderProgram,
  type WebGLContext,
} from "./webgl.ts";
import {
  fullScreenQuadVertexShader,
  rotorFragmentShader,
} from "./shaders.ts";

const canvas = document.getElementById("sim-canvas") as HTMLCanvasElement;
const webglCanvas = document.getElementById("webgl-canvas") as HTMLCanvasElement;
const overlayCanvas = document.getElementById(
  "overlay-canvas",
) as HTMLCanvasElement;

// ============================================================================
// WEBGL2 INITIALIZATION
// ============================================================================

let webgl: WebGLContext | null = null;
let rotorProgram: ShaderProgram | null = null;
let fullScreenQuad: { vao: WebGLVertexArrayObject; vertexCount: number } | null =
  null;
let webglContextLost = false;
let rotorTextures: RotorStateTextures | null = null;
let _currentLSide = 0;
let useWebGL2Rendering = false; // Toggle between Canvas2D and WebGL2

/**
 * Initialize WebGL2 context and resources
 */
function initWebGL(): boolean {
  const support = checkWebGL2Support();
  if (!support.supported) {
    console.warn("WebGL2 not supported, falling back to Canvas 2D");
    return false;
  }

  console.log("WebGL2 support detected:", {
    maxTextureSize: support.maxTextureSize,
    maxTextureImageUnits: support.maxTextureImageUnits,
  });

  webgl = initWebGL2(webglCanvas);
  if (!webgl) {
    console.warn("Failed to initialize WebGL2 context");
    return false;
  }

  // Setup context lost/restored handlers
  setupContextHandlers(
    webglCanvas,
    (e) => {
      console.warn("WebGL context lost");
      webglContextLost = true;
      e.preventDefault(); // Allow restoration
    },
    () => {
      console.log("WebGL context restored");
      webglContextLost = false;
      // Re-initialize resources
      initWebGLResources();
    },
  );

  return initWebGLResources();
}

/**
 * Create shader programs and geometry
 */
function initWebGLResources(): boolean {
  if (!webgl) return false;
  const { gl } = webgl;

  // Create rotor rendering shader program
  rotorProgram = createShaderProgram(
    gl,
    fullScreenQuadVertexShader,
    rotorFragmentShader,
    ["a_position"],
    ["u_thetaTexture", "u_omegaTexture", "u_latticeSize", "u_upsample"],
  );

  if (!rotorProgram) {
    console.error("Failed to create rotor shader program");
    return false;
  }

  // Create full-screen quad
  fullScreenQuad = createFullScreenQuad(gl);
  if (!fullScreenQuad) {
    console.error("Failed to create full-screen quad");
    return false;
  }

  // Initial viewport setup
  const { width, height } = resizeCanvasToDisplaySize(webglCanvas);
  gl.viewport(0, 0, width, height);

  console.log("WebGL2 initialized successfully");
  return true;
}

/**
 * Render rotors using WebGL2
 */
function renderRotorsWebGL2(
  lSide: number,
  upsample: number,
): void {
  if (!webgl || !rotorProgram || !fullScreenQuad || !rotorTextures || webglContextLost) {
    return;
  }

  const { gl } = webgl;

  // Resize if needed
  const { width, height } = resizeCanvasToDisplaySize(webglCanvas);
  if (gl.canvas.width !== width || gl.canvas.height !== height) {
    gl.viewport(0, 0, width, height);
  }

  // Clear canvas
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Enable blending for anti-aliased edges
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // Use rotor shader
  gl.useProgram(rotorProgram.program);

  // Bind textures
  const thetaLoc = rotorProgram.uniformLocations.get("u_thetaTexture");
  const omegaLoc = rotorProgram.uniformLocations.get("u_omegaTexture");
  _bindRotorStateTextures(gl, rotorTextures, thetaLoc ?? null, omegaLoc ?? null, 0, 1);

  // Set uniforms
  const latticeSizeLoc = rotorProgram.uniformLocations.get("u_latticeSize");
  if (latticeSizeLoc !== undefined && latticeSizeLoc !== null) {
    gl.uniform2f(latticeSizeLoc, lSide, lSide);
  }

  const upsampleLoc = rotorProgram.uniformLocations.get("u_upsample");
  if (upsampleLoc !== undefined && upsampleLoc !== null) {
    gl.uniform1f(upsampleLoc, upsample);
  }

  // Draw full-screen quad
  gl.bindVertexArray(fullScreenQuad.vao);
  gl.drawArrays(gl.TRIANGLES, 0, fullScreenQuad.vertexCount);
  gl.bindVertexArray(null);

  // Disable blending
  gl.disable(gl.BLEND);
}

/**
 * Initialize or resize rotor state textures for WebGL2 rendering
 */
function initRotorTextures(lSide: number): boolean {
  if (!webgl) return false;

  // Clean up existing textures if lattice size changed
  if (rotorTextures && rotorTextures.lSide !== lSide) {
    deleteRotorStateTextures(webgl.gl, rotorTextures);
    rotorTextures = null;
  }

  // Create new textures if needed
  if (!rotorTextures) {
    rotorTextures = createRotorStateTextures(webgl.gl, lSide);
    if (rotorTextures) {
      console.log(`[RotorArray] Created rotor textures: ${lSide}x${lSide}`);
    }
  }

  _currentLSide = lSide;
  return rotorTextures !== null;
}

/**
 * Update rotor state textures from Float64Array data
 */
function updateRotorTextures(
  theta: Float64Array,
  omega: Float64Array,
): boolean {
  if (!webgl || !rotorTextures) return false;
  return updateRotorStateTextures(webgl.gl, rotorTextures, theta, omega);
}

// Try to initialize WebGL2
console.log("[RotorArray] Starting WebGL2 initialization...");

// Visual status indicator
const webglStatusEl = document.createElement("div");
webglStatusEl.id = "webgl-status";
webglStatusEl.style.cssText = "position:fixed;top:10px;left:10px;padding:8px 12px;border-radius:4px;font-family:monospace;font-size:12px;z-index:9999;transition:all 0.3s;";
document.body.appendChild(webglStatusEl);

function setStatus(msg: string, color: string) {
  webglStatusEl.textContent = `WebGL2: ${msg}`;
  webglStatusEl.style.background = color;
  webglStatusEl.style.color = color === "#ffeb3b" ? "#000" : "#fff";
  console.log(`[RotorArray] WebGL2 status: ${msg}`);
}

setStatus("initializing...", "#2196f3");

let _webglInitialized = false;
try {
  _webglInitialized = initWebGL();
  if (_webglInitialized) {
    setStatus("ready", "#4caf50");
  } else {
    setStatus("fallback to Canvas2D", "#ff9800");
  }
} catch (err) {
  console.error("[RotorArray] WebGL2 initialization failed:", err);
  setStatus(`error: ${err instanceof Error ? err.message : String(err)}`, "#f44336");
}

  // Auto-hide after 5 seconds
  setTimeout(() => {
    webglStatusEl.style.opacity = "0.5";
  }, 5000);

  // Add click handler to toggle render mode
  webglStatusEl.style.cursor = "pointer";
  webglStatusEl.title = "Click to toggle WebGL2 rendering";
  webglStatusEl.addEventListener("click", () => {
    useWebGL2Rendering = !useWebGL2Rendering;
    // Toggle canvas visibility
    if (useWebGL2Rendering) {
      canvas.style.display = "none";
      webglCanvas.style.display = "block";
      setStatus("WebGL2 active (click to use Canvas2D)", "#4caf50");
    } else {
      canvas.style.display = "block";
      webglCanvas.style.display = "none";
      setStatus("Canvas2D active (click to use WebGL2)", "#2196f3");
    }
    console.log(`[RotorArray] Switched to ${useWebGL2Rendering ? "WebGL2" : "Canvas2D"} rendering`);
  });
const mdCanvas = document.getElementById(
  "mean-dir-canvas",
) as HTMLCanvasElement;

// Get canvas context for drawing ImageBitmap
// Note: WebGL2 uses a separate canvas to avoid context conflicts
const bitmapCtx = canvas.getContext("bitmaprenderer");
const ctx2d = bitmapCtx ? null : canvas.getContext("2d");
// Only throw if WebGL2 isn't active - if WebGL2 is initialized, we don't need these
if (!bitmapCtx && !ctx2d && !webgl) {
  throw new Error("Failed to get canvas context");
}

const overlayCtx = overlayCanvas.getContext("2d");
if (!overlayCtx) throw new Error("Failed to get overlay canvas context");

const mdViz = new MeanDirectionVisualizer(mdCanvas);
const plot = new OrderPlot("uplot-chart");
const controls = new ControlPanel("controls-container");
new ColorBarVisualizer("color-bar-container");
const energyPerNodeEl = document.getElementById("energy-per-node-value");
const energyRelDevEl = document.getElementById("energy-rel-dev-value");

const worker = new Worker(new URL("./worker.js", import.meta.url), {
  type: "module",
});
worker.postMessage({ type: "init" });

let lastUiUpdate = 0;
let displaySize = 0;

worker.onmessage = (e) => {
  const { type, payload } = e.data;

  if (type === "frame") {
    const {
      imageBitmap,
      theta: thetaBuf,
      omega: omegaBuf,
      orderParameter,
      lSide,
      canvasSize,
      upsample,
    } = payload;

    // Resize canvases if needed
    if (canvas.width !== canvasSize || canvas.height !== canvasSize) {
      canvas.width = canvasSize;
      canvas.height = canvasSize;
      overlayCanvas.width = canvasSize;
      overlayCanvas.height = canvasSize;
    }

    // Initialize/resize rotor textures if needed
    if (webgl && thetaBuf && omegaBuf) {
      initRotorTextures(lSide);
      updateRotorTextures(new Float64Array(thetaBuf), new Float64Array(omegaBuf));
    }

    if (displaySize > 0) {
      const sizePx = `${displaySize}px`;
      if (canvas.style.width !== sizePx) {
        canvas.style.width = sizePx;
        canvas.style.height = sizePx;
        overlayCanvas.style.width = sizePx;
        overlayCanvas.style.height = sizePx;
        webglCanvas.style.width = sizePx;
        webglCanvas.style.height = sizePx;
      }
    }

    // Render using WebGL2 or Canvas2D based on toggle
    if (useWebGL2Rendering && webgl && rotorTextures) {
      // WebGL2 rendering
      renderRotorsWebGL2(lSide, upsample);
      // Still need to close the ImageBitmap even though we're not using it
      imageBitmap.close();
    } else {
      // Canvas2D rendering (fallback)
      if (bitmapCtx) {
        bitmapCtx.transferFromImageBitmap(imageBitmap);
      } else if (ctx2d) {
        ctx2d.drawImage(imageBitmap, 0, 0);
      }
      imageBitmap.close();
    }

    // Clear overlay to prevent arrow artifacts from previous frames
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // Draw arrows if enabled and disks are large enough
    if (
      controls.arrowCheck.checked &&
      thetaBuf &&
      upsample >= 4 &&
      lSide <= 60
    ) {
      drawArrows(overlayCtx, new Float64Array(thetaBuf), lSide, upsample);
    }

    const now = performance.now();
    if (now - lastUiUpdate > UI_UPDATE_INTERVAL_MS) {
      plot.push(orderParameter.t, orderParameter.r);
      mdViz.update(
        orderParameter.r,
        orderParameter.meanCos,
        orderParameter.meanSin,
      );
      lastUiUpdate = now;
    }
  }

  if (type === "energyStats") {
    const { perNode, relDev } = payload;
    if (energyPerNodeEl) {
      energyPerNodeEl.textContent = formatNumber(perNode);
    }
    if (energyRelDevEl) {
      energyRelDevEl.textContent = formatRelDeviation(relDev);
    }
  }
};

/**
 * Draw direction arrows on the canvas.
 * Arrows are drawn when individual rotors are large enough to see.
 * @param ctx - Canvas rendering context
 * @param theta - Float64Array of rotor angles
 * @param lSide - Lattice side length (L)
 * @param upsample - Pixel multiplier per rotor
 */
function drawArrows(
  ctx: CanvasRenderingContext2D,
  theta: Float64Array,
  lSide: number,
  upsample: number,
) {
  const L = lSide;
  const S = upsample;
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

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const absValue = Math.abs(value);
  if (absValue >= 0.01 && absValue < 1000) {
    return value.toFixed(4);
  }
  return value.toExponential(3);
}

function formatRelDeviation(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toExponential(1);
}

controls.onReset = (preset, k, p2, p3, temp) => {
  const lSide = parseInt(controls.lInput.value) || DEFAULT_LATTICE_SIZE;
  const { theta, omega } = generateInitialState(lSide, preset, k, p2, p3, temp);

  // Calculate upsample based on canvas size (same logic as before)
  const container = canvas.parentElement;
  const width = container ? container.clientWidth - CANVAS_PADDING : 600;
  const height = container ? container.clientHeight - CANVAS_PADDING : 600;
  const size = Math.max(100, Math.min(width, height));
  const upsample = Math.max(1, Math.floor(size / lSide));
  displaySize = size;
  const sizePx = `${displaySize}px`;
  canvas.style.width = sizePx;
  canvas.style.height = sizePx;
  overlayCanvas.style.width = sizePx;
  overlayCanvas.style.height = sizePx;

  worker.postMessage({
    type: "reset",
    payload: {
      lSide,
      jCoupling: parseFloat(controls.jInput.value) / SLIDER_SCALE,
      mField: parseFloat(controls.mInput.value) / SLIDER_SCALE,
      theta,
      omega,
      upsample,
      showArrows: controls.arrowCheck.checked,
    },
  });

  plot.reset();
  controls.isRunning = false;
  controls.startBtn.textContent = "Start";
  controls.startBtn.classList.remove("active");
  controls.toggleInputs(true);
};

controls.onParamChange = (j, m, t) => {
  worker.postMessage({ type: "updateParams", payload: { j, m, t } });
};

controls.onArrowChange = (show) => {
  worker.postMessage({
    type: "setRenderOptions",
    payload: { showArrows: show },
  });
};

controls.onStartStop = (running) => {
  worker.postMessage({ type: running ? "start" : "stop" });
};

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
  if (e.target === helpOverlay) {
    helpOverlay.style.display = "none";
  }
});

setTimeout(() => {
  controls.triggerReset();
}, 200);

// ============================================================================
// LOCAL STORAGE PERSISTENCE
// ============================================================================

const STORAGE_KEY = "rotorArrayParams";

/**
 * Save current parameters to localStorage.
 * Called before page unload and when parameters change.
 */
function saveParameters() {
  try {
    const params = {
      lSide: controls.lInput.value,
      preset: controls.presetSelect.value,
      j: controls.jInput.value,
      m: controls.mInput.value,
      timeScale: controls.timeInput.value,
      temp: controls.tempInput.value,
      showArrows: controls.arrowCheck.checked,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {
    // localStorage may not be available (private mode, etc.)
  }
}

/**
 * Load saved parameters from localStorage.
 * Called on page load.
 */
function loadParameters() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const params = JSON.parse(saved);

      // Restore values if they exist
      if (params.lSide) controls.lInput.value = params.lSide;
      if (params.preset) controls.presetSelect.value = params.preset;
      if (params.j) {
        controls.jInput.value = params.j;
        // Update label
        const val = parseFloat(params.j) / SLIDER_SCALE;
        // Find and update the label
        const jLabel = controls.jInput.parentElement?.querySelector("label");
        if (jLabel) jLabel.textContent = `Coupling (J): ${val.toFixed(2)}`;
      }
      if (params.m) {
        controls.mInput.value = params.m;
        const val = parseFloat(params.m) / SLIDER_SCALE;
        const mLabel = controls.mInput.parentElement?.querySelector("label");
        if (mLabel) mLabel.textContent = `Field (M): ${val.toFixed(2)}`;
      }
      if (params.timeScale) {
        controls.timeInput.value = params.timeScale;
        const val = parseFloat(params.timeScale) / SLIDER_SCALE;
        const tLabel = controls.timeInput.parentElement?.querySelector("label");
        if (tLabel) tLabel.textContent = `Time Scale: ${val.toFixed(1)}x`;
      }
      if (params.temp) {
        controls.tempInput.value = params.temp;
        const val = parseFloat(params.temp) / SLIDER_SCALE;
        const tempLabel = controls.tempInput.parentElement?.querySelector(
          "label",
        );
        if (tempLabel) {
          tempLabel.textContent = `Initial Temp (T): ${val.toFixed(2)}`;
        }
      }
      if (params.showArrows !== undefined) {
        controls.arrowCheck.checked = params.showArrows;
      }

      // Update preset-specific UI (k, p2, p3 fields)
      controls.updatePresetUI();
    }
  } catch {
    // localStorage may not be available or data may be corrupt
  }
}

// Load saved parameters on startup
loadParameters();

// Save parameters when window is about to close
globalThis.addEventListener("beforeunload", saveParameters);

// Save parameters when they change
controls.jInput.addEventListener("change", saveParameters);
controls.mInput.addEventListener("change", saveParameters);
controls.timeInput.addEventListener("change", saveParameters);
controls.tempInput.addEventListener("change", saveParameters);
controls.lInput.addEventListener("change", saveParameters);
controls.presetSelect.addEventListener("change", saveParameters);
controls.arrowCheck.addEventListener("change", saveParameters);

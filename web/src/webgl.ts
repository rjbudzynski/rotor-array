/**
 * WebGL2 utilities for Rotor Array Simulation
 * Handles context creation, shader compilation, and program linking
 */

export interface ShaderProgram {
  program: WebGLProgram;
  attribLocations: Map<string, GLint>;
  uniformLocations: Map<string, WebGLUniformLocation | null>;
}

export interface WebGLContext {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  loseContextExt: WEBGL_lose_context | null;
}

/**
 * Compile a shader from source
 */
function compileShader(
  gl: WebGL2RenderingContext,
  source: string,
  type: number,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) {
    console.error("Failed to create shader");
    return null;
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    console.error(`Shader compilation failed: ${info}`);
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}

/**
 * Link vertex and fragment shaders into a program
 */
function linkProgram(
  gl: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader,
): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) {
    console.error("Failed to create program");
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    console.error(`Program linking failed: ${info}`);
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

/**
 * Create a shader program from vertex and fragment shader sources
 */
export function createShaderProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  attribs?: string[],
  uniforms?: string[],
): ShaderProgram | null {
  const vertexShader = compileShader(gl, vertexSource, gl.VERTEX_SHADER);
  const fragmentShader = compileShader(gl, fragmentSource, gl.FRAGMENT_SHADER);

  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    return null;
  }

  const program = linkProgram(gl, vertexShader, fragmentShader);

  // Shaders can be detached and deleted after linking
  gl.detachShader(program!, vertexShader);
  gl.detachShader(program!, fragmentShader);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!program) {
    return null;
  }

  // Cache attribute locations
  const attribLocations = new Map<string, GLint>();
  if (attribs) {
    for (const name of attribs) {
      const loc = gl.getAttribLocation(program, name);
      attribLocations.set(name, loc);
    }
  }

  // Cache uniform locations
  const uniformLocations = new Map<string, WebGLUniformLocation | null>();
  if (uniforms) {
    for (const name of uniforms) {
      const loc = gl.getUniformLocation(program, name);
      uniformLocations.set(name, loc);
    }
  }

  return {
    program,
    attribLocations,
    uniformLocations,
  };
}

/**
 * Create a full-screen quad vertex buffer (clip space: -1 to +1)
 * Returns VAO and vertex count
 */
export function createFullScreenQuad(
  gl: WebGL2RenderingContext,
): { vao: WebGLVertexArrayObject; vertexCount: number } | null {
  // Two triangles covering the full screen
  const positions = new Float32Array([
    -1, -1, // bottom-left
    1, -1, // bottom-right
    -1, 1, // top-left
    -1, 1, // top-left
    1, -1, // bottom-right
    1, 1, // top-right
  ]);

  const vao = gl.createVertexArray();
  if (!vao) {
    console.error("Failed to create VAO");
    return null;
  }

  const vbo = gl.createBuffer();
  if (!vbo) {
    console.error("Failed to create VBO");
    gl.deleteVertexArray(vao);
    return null;
  }

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  // VBO is referenced by VAO, can delete (or keep if needed)
  gl.deleteBuffer(vbo);

  return { vao, vertexCount: 6 };
}

/**
 * Initialize WebGL2 context with optional attributes
 */
export function initWebGL2(
  canvas: HTMLCanvasElement,
  options?: WebGLContextAttributes,
): WebGLContext | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
    ...options,
  });

  if (!gl) {
    console.error("WebGL2 not supported");
    return null;
  }

  // Get lose context extension for testing
  const loseContextExt = gl.getExtension("WEBGL_lose_context");

  return {
    gl,
    canvas,
    loseContextExt,
  };
}

/**
 * Check WebGL2 support and capabilities
 */
export function checkWebGL2Support(): {
  supported: boolean;
  maxTextureSize: number;
  maxTextureImageUnits: number;
  extensions: string[];
} {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2");

  if (!gl) {
    return {
      supported: false,
      maxTextureSize: 0,
      maxTextureImageUnits: 0,
      extensions: [],
    };
  }

  const extensions = gl.getSupportedExtensions() || [];

  return {
    supported: true,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number,
    extensions,
  };
}

/**
 * Context lost/restored event handler type
 */
export type ContextEventHandler = (event: Event) => void;

/**
 * Setup WebGL context event handlers
 */
export function setupContextHandlers(
  canvas: HTMLCanvasElement,
  onLost: ContextEventHandler,
  onRestored: ContextEventHandler,
): () => void {
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  // Return cleanup function
  return () => {
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
  };
}

/**
 * Resize canvas to match display size with proper DPR handling
 */
export function resizeCanvasToDisplaySize(
  canvas: HTMLCanvasElement,
  dpr?: number,
): { width: number; height: number } {
  const displayWidth = Math.floor(canvas.clientWidth);
  const displayHeight = Math.floor(canvas.clientHeight);
  const pixelRatio = dpr ?? globalThis.devicePixelRatio ?? 1;

  const targetWidth = Math.floor(displayWidth * pixelRatio);
  const targetHeight = Math.floor(displayHeight * pixelRatio);

  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }

  return { width: targetWidth, height: targetHeight };
}

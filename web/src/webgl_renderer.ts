import {
  bindRotorStateTextures,
  createArrowGeometry,
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
  arrowFragmentShader,
  arrowVertexShader,
  debugTextureShader,
  fullScreenQuadVertexShader,
  rotorFragmentShader,
} from "./shaders.ts";

export class WebGLRenderer {
  private canvas: HTMLCanvasElement;
  private webgl: WebGLContext | null = null;
  private rotorProgram: ShaderProgram | null = null;
  private debugProgram: ShaderProgram | null = null;
  private arrowProgram: ShaderProgram | null = null;
  private fullScreenQuad: { vao: WebGLVertexArrayObject; vertexCount: number } | null = null;
  private arrowGeometry: { vao: WebGLVertexArrayObject; vertexCount: number } | null = null;
  private rotorTextures: RotorStateTextures | null = null;
  private webglContextLost = false;
  
  public useDebugShader = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  public init(): boolean {
    this.webgl = initWebGL2(this.canvas);
    if (!this.webgl) {
      console.warn("Failed to initialize WebGL2 context");
      return false;
    }

    // Setup context lost/restored handlers
    setupContextHandlers(
      this.canvas,
      (e) => {
        console.warn("WebGL context lost");
        this.webglContextLost = true;
        e.preventDefault(); // Allow restoration
      },
      () => {
        console.log("WebGL context restored");
        this.webglContextLost = false;
        // Re-initialize resources
        this.initResources();
      },
    );

    return this.initResources();
  }

  private initResources(): boolean {
    if (!this.webgl) return false;
    const { gl } = this.webgl;

    // Create rotor rendering shader program
    this.rotorProgram = createShaderProgram(
      gl,
      fullScreenQuadVertexShader,
      rotorFragmentShader,
      ["a_position"],
      ["u_thetaTexture", "u_omegaTexture", "u_latticeSize", "u_upsample"],
    );

    if (!this.rotorProgram) {
      console.error("Failed to create rotor shader program");
      return false;
    }

    // Create debug shader program for diagnosing texture issues
    this.debugProgram = createShaderProgram(
      gl,
      fullScreenQuadVertexShader,
      debugTextureShader,
      ["a_position"],
      ["u_thetaTexture", "u_omegaTexture", "u_latticeSize"],
    );

    if (!this.debugProgram) {
      console.error("Failed to create debug shader program");
      return false;
    }

    // Create arrow rendering shader program
    this.arrowProgram = createShaderProgram(
      gl,
      arrowVertexShader,
      arrowFragmentShader,
      ["a_position"],
      ["u_thetaTexture", "u_latticeSize", "u_upsample"],
    );

    if (!this.arrowProgram) {
      console.error("Failed to create arrow shader program");
      return false;
    }

    // Create full-screen quad
    this.fullScreenQuad = createFullScreenQuad(gl);
    if (!this.fullScreenQuad) {
      console.error("Failed to create full-screen quad");
      return false;
    }

    // Create arrow geometry
    this.arrowGeometry = createArrowGeometry(gl);
    if (!this.arrowGeometry) {
      console.error("Failed to create arrow geometry");
      return false;
    }

    // Initial viewport setup
    const { width, height } = resizeCanvasToDisplaySize(this.canvas);
    gl.viewport(0, 0, width, height);

    console.log("WebGL2 renderer initialized successfully");
    return true;
  }

  public updateTextures(lSide: number, theta: Float32Array, omega: Float32Array): boolean {
    if (!this.webgl) return false;
    const { gl } = this.webgl;

    // Clean up existing textures if lattice size changed
    if (this.rotorTextures && this.rotorTextures.lSide !== lSide) {
      deleteRotorStateTextures(gl, this.rotorTextures);
      this.rotorTextures = null;
    }

    // Create new textures if needed
    if (!this.rotorTextures) {
      this.rotorTextures = createRotorStateTextures(gl, lSide);
      if (this.rotorTextures) {
        console.log(`[WebGLRenderer] Created rotor textures: ${lSide}x${lSide}`);
      }
    }

    if (!this.rotorTextures) return false;

    return updateRotorStateTextures(gl, this.rotorTextures, theta, omega);
  }

  public render(lSide: number, upsample: number, showArrows: boolean): void {
    if (!this.webgl || !this.fullScreenQuad || !this.rotorTextures || this.webglContextLost) {
      return;
    }

    const { gl } = this.webgl;

    // Resize if needed
    const { width, height } = resizeCanvasToDisplaySize(this.canvas);
    gl.viewport(0, 0, width, height);

    // Clear canvas
    gl.clearColor(0.1, 0.1, 0.1, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Choose shader program
    const program = (this.useDebugShader && this.debugProgram) ? this.debugProgram : this.rotorProgram;
    if (!program) return;

    // Enable blending for anti-aliased edges
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Use shader
    gl.useProgram(program.program);

    // Bind textures
    const thetaLoc = program.uniformLocations.get("u_thetaTexture");
    const omegaLoc = program.uniformLocations.get("u_omegaTexture");
    bindRotorStateTextures(gl, this.rotorTextures, thetaLoc ?? null, omegaLoc ?? null, 0, 1);

    // Set uniforms
    const latticeSizeLoc = program.uniformLocations.get("u_latticeSize");
    if (latticeSizeLoc) {
      gl.uniform2f(latticeSizeLoc, lSide, lSide);
    }

    const upsampleLoc = program.uniformLocations.get("u_upsample");
    if (upsampleLoc) {
      gl.uniform1f(upsampleLoc, upsample);
    }

    // Draw full-screen quad
    gl.bindVertexArray(this.fullScreenQuad.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.fullScreenQuad.vertexCount);
    gl.bindVertexArray(null);

    // Render arrows if requested
    if (showArrows && upsample >= 4 && lSide <= 60) {
      this.renderArrows(lSide, upsample);
    }

    gl.disable(gl.BLEND);
    gl.flush();
  }

  private renderArrows(lSide: number, upsample: number): void {
    if (!this.webgl || !this.arrowGeometry || !this.rotorTextures || !this.arrowProgram) {
      return;
    }

    const { gl } = this.webgl;
    gl.useProgram(this.arrowProgram.program);

    // Bind theta texture (already in unit 0 from render call, but being explicit is safer)
    const thetaLoc = this.arrowProgram.uniformLocations.get("u_thetaTexture");
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.rotorTextures.thetaTexture);
    if (thetaLoc) {
      gl.uniform1i(thetaLoc, 0);
    }

    // Set uniforms
    const latticeSizeLoc = this.arrowProgram.uniformLocations.get("u_latticeSize");
    if (latticeSizeLoc) {
      gl.uniform2f(latticeSizeLoc, lSide, lSide);
    }

    const upsampleLoc = this.arrowProgram.uniformLocations.get("u_upsample");
    if (upsampleLoc) {
      gl.uniform1f(upsampleLoc, upsample);
    }

    // Draw instanced arrows
    gl.bindVertexArray(this.arrowGeometry.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, this.arrowGeometry.vertexCount, lSide * lSide);
    gl.bindVertexArray(null);
  }
}

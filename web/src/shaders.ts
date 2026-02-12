/**
 * Vertex shader for full-screen quad rendering
 * Passes clip space position and UV coordinates to fragment shader
 */
export const fullScreenQuadVertexShader = `#version 300 es

layout(location = 0) in vec2 a_position;

out vec2 v_uv;

void main() {
    v_uv = a_position * 0.5 + 0.5; // Convert from [-1, 1] to [0, 1]
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/**
 * Fragment shader for initial WebGL2 test rendering
 * Renders a gradient to verify the pipeline is working
 */
export const testFragmentShader = `#version 300 es

precision highp float;

in vec2 v_uv;

out vec4 fragColor;

void main() {
    // Simple gradient for testing
    fragColor = vec4(v_uv.x, v_uv.y, 0.5, 1.0);
}
`;

/**
 * Debug fragment shader that visualizes texture data directly
 * Helps diagnose if textures are being uploaded correctly
 */
export const debugTextureShader = `#version 300 es

precision highp float;

in vec2 v_uv;

uniform sampler2D u_thetaTexture;
uniform sampler2D u_omegaTexture;
uniform vec2 u_latticeSize;

out vec4 fragColor;

void main() {
    // Map v_uv [0,1] to lattice coordinates [0, L-1]
    // Flip Y because v_uv.y=0 is bottom but simulation row 0 is top
    vec2 flippedUV = vec2(v_uv.x, 1.0 - v_uv.y);
    vec2 latticeCoord = flippedUV * u_latticeSize;
    ivec2 cell = clamp(ivec2(floor(latticeCoord)), ivec2(0), ivec2(u_latticeSize) - 1);
    
    float theta = texelFetch(u_thetaTexture, cell, 0).r;
    float omega = texelFetch(u_omegaTexture, cell, 0).r;
    
    // Visualize theta as red channel, omega as green channel
    // This helps us see if data is in the textures
    float thetaNorm = (theta + 3.14159265359) / (2.0 * 3.14159265359); // Normalize to [0,1]
    float omegaNorm = min(abs(omega) / 5.0, 1.0); // Normalize omega magnitude
    
    fragColor = vec4(thetaNorm, omegaNorm, 0.5, 1.0);
}
`;

/**
 * Fragment shader for rotor visualization
 * Renders anti-aliased disks with color based on angle (hue) and energy (value)
 * Uses SDF (Signed Distance Field) for smooth edges
 */
export const rotorFragmentShader = `#version 300 es

precision highp float;

in vec2 v_uv;

uniform sampler2D u_thetaTexture;
uniform sampler2D u_omegaTexture;
uniform vec2 u_latticeSize; // L x L
uniform float u_upsample;   // Pixels per rotor

out vec4 fragColor;

// HSV to RGB conversion
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    // Calculate which rotor cell we're in
    // Flip Y because v_uv.y=0 is bottom but simulation row 0 is top
    vec2 flippedUV = vec2(v_uv.x, 1.0 - v_uv.y);
    vec2 latticeCoord = flippedUV * u_latticeSize;
    ivec2 cell = clamp(ivec2(floor(latticeCoord)), ivec2(0), ivec2(u_latticeSize) - 1);
    
    // Sample theta and omega from textures
    float theta = texelFetch(u_thetaTexture, cell, 0).r;
    float omega = texelFetch(u_omegaTexture, cell, 0).r;
    
    // Calculate position within the rotor cell (0 to 1)
    vec2 cellUV = fract(latticeCoord);
    
    // Center of cell is at (0.5, 0.5)
    vec2 centerOffset = cellUV - vec2(0.5);
    
    // Calculate distance from center (for disk shape)
    float dist = length(centerOffset);
    
    // Transition from disks to solid squares (pixels) when small (upsample < 4)
    // This matches the behavior in visualizer.rs
    float alpha = 1.0;
    if (u_upsample >= 4.0) {
        float diskRadius = 0.45;
        // 1-pixel wide transition for consistent anti-aliasing
        float halfEdge = 0.5 / u_upsample;
        alpha = 1.0 - smoothstep(diskRadius - halfEdge, diskRadius + halfEdge, dist);
    }
    
    // Map theta to hue: theta in [-PI, PI] -> hue in [0, 1]
    // Uses HUE_OFFSET = 0.666 to match colors.ts/colors.rs
    float hue = (theta / (2.0 * 3.14159265359)) + 0.666;
    hue = fract(hue); // Wrap to [0, 1]
    
    // Map omega^2 to value (brightness)
    // omega^2 represents kinetic energy
    float energy = omega * omega;
    // Map energy to value with tanh curve to match colors.ts/colors.rs
    // val_min = 0.4, val_max = 0.8
    float value = 0.4 + (0.8 - 0.4) * tanh(energy / 5.0);
    
    // Convert HSV to RGB
    vec3 rgb = hsv2rgb(vec3(hue, 1.0, value));
    
    // Output with alpha
    fragColor = vec4(rgb, alpha);
}
`;

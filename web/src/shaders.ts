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
 * Fragment shader placeholder for rotor visualization
 * This will be implemented in the next phase (rotor-array-g5z)
 */
export const rotorFragmentShaderPlaceholder = `#version 300 es

precision highp float;

in vec2 v_uv;

uniform sampler2D u_thetaTexture;
uniform sampler2D u_omegaTexture;
uniform vec2 u_latticeSize; // L x L
uniform float u_upsample;

out vec4 fragColor;

// HSV to RGB conversion
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    // Convert UV to lattice coordinates
    vec2 latticeCoord = v_uv * u_latticeSize * u_upsample;
    ivec2 cell = ivec2(floor(latticeCoord));
    
    // Sample theta and omega (placeholder - textures not yet implemented)
    // float theta = texelFetch(u_thetaTexture, cell, 0).r;
    // float omega = texelFetch(u_omegaTexture, cell, 0).r;
    
    // Placeholder: gradient based on position
    float hue = v_uv.x;
    float value = 0.5 + 0.5 * sin(v_uv.y * 10.0);
    
    vec3 rgb = hsv2rgb(vec3(hue, 1.0, value));
    fragColor = vec4(rgb, 1.0);
}
`;

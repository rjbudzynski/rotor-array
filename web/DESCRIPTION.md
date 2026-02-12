# Technical Description: Rotor Array Simulation (Web)

This document describes the architecture, algorithms, and optimizations employed in the web implementation of the Rotor Array Simulation.

## 1. System Architecture

The application is built using a hybrid **TypeScript/Rust** architecture, leveraging **WebAssembly (WASM)** for high-performance physics and **WebGL2** for accelerated rendering.

- **Main Thread (TypeScript):** Manages the user interface, input handling, real-time plotting (uPlot), mathematical rendering (KaTeX), and the **WebGL2 Rendering Pipeline**.
- **Simulation Worker (TypeScript/WASM):** Executes the physics engine in a dedicated Web Worker to ensure UI responsiveness. It transfers raw rotor state data ($\theta, \omega$) and fallback rendered frames to the main thread.
- **Physics Core (Rust/WASM):** Implements the Hamiltonian dynamics and state-to-image rendering for legacy/fallback paths.

## 2. Algorithms & Physics

### 2.1 Symplectic Integration
The system simulates $L \times L$ coupled planar rotors using a **Velocity Verlet** integrator. This symplectic method ensures long-term energy stability and time-reversibility, critical for Hamiltonian systems.

### 2.2 Adaptive Sub-stepping
To maintain stability across varying coupling strengths ($J$) and external fields ($M$), the engine employs **adaptive sub-stepping**. The number of sub-steps per frame is dynamically calculated as:
$$N_{substeps} = \lceil \frac{\Delta t \cdot \sqrt{8|J| + |M|}}{\epsilon} \rceil$$
where $\epsilon$ is a stability factor. This ensures the integration remains accurate even during high-energy oscillations or strong coupling.

### 2.3 Trigonometric Look-up Table (LUT)
To bypass the high cost of standard library `sin` and `cos` calls in the integration loop, a **Trigonometric LUT** with linear interpolation is used. It employs 8,192 steps over $2\pi$, providing high precision with significantly reduced CPU cycles.

### 2.4 Order Parameter Calculation
The system order parameter $r = |\frac{1}{N} \sum_{j=1}^N e^{i\theta_j}|$ is computed in Rust to monitor phase transitions and synchronization in real-time.

## 3. Visualization & Rendering

### 3.1 Hybrid Rendering Pipeline
- **WebGL2 Renderer (Primary):** Rotors are rendered as a full-screen quad using an optimized fragment shader. The rotor states are uploaded to the GPU as floating-point textures (R32F), and the shader performs Hue-Value mapping and SDF-based disk rendering on-the-fly.
- **Lattice Disks (WASM Fallback):** For older browsers, rotors are rendered in the worker as disks using a pre-computed alpha mask.
- **Overlay Arrows (TypeScript):** Directional arrows are currently rendered on a separate canvas overlay using the standard 2D API.

### 3.2 Color Mapping & Anti-Aliasing
- **SDF Disk Rendering:** WebGL2 uses Signed Distance Fields (SDF) in the fragment shader to provide high-quality anti-aliased edges.
- **Adaptive LOD:** The system transitions from rendering disks to solid pixels when the lattice density exceeds the display resolution (upsample < 4), improving performance and visual clarity for large systems.
- **Color Mapping:** A consistent **Hue-Value** mapping is shared across all rendering paths:
  - **Hue:** Angle $\theta \in [-\pi, \pi]$ using a configurable offset for optimal aesthetics.
  - **Value/Brightness:** Kinetic energy $\omega^2$ mapped via a `tanh` saturation curve.

## 4. Optimizations

### 4.1 Zero-Copy Data Transfer
- **Direct WASM Memory Access:** The TypeScript worker accesses the WASM linear memory directly using `Uint8ClampedArray` to create `ImageData` without copying pixel data.
- **ImageBitmap Transfer:** Rendering results are moved from the Worker to the Main Thread via `transferToImageBitmap()`, which transfers ownership of the underlying graphics memory.

### 4.2 Computation Optimizations
- **Unsafe Indexing:** Rust code utilizes `get_unchecked` and `get_unchecked_mut` in hot loops (integration and rendering) to elide bounds checks, after manually ensuring safety.
- **U32 Buffer Clearing:** The RGBA buffer is cleared using `u32` slice operations, which is significantly faster than per-channel clearing.
- **Tight Scheduling:** A `MessageChannel` is used to schedule simulation loops, bypassing the 4ms minimum clamping enforced on `setTimeout` and `setInterval` by most browsers.

## 5. Technology Stack
- **Language:** TypeScript 5.x, Rust 1.75+
- **Tooling:** Deno (Build/Tasks), wasm-bindgen (WASM FFI)
- **UI & Visualization:** uPlot (Charts), KaTeX (Math), Custom CSS Flexbox (Layout)
- **Runtime:** Modern Web Browsers (supporting Web Workers, WASM, and OffscreenCanvas)

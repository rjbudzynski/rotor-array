# Technical Description: Rotor Array Simulation (Web)

This document describes the architecture, algorithms, and optimizations employed in the web implementation of the Rotor Array Simulation.

## 1. System Architecture

The application is built using a hybrid **TypeScript/Rust** architecture, leveraging **WebAssembly (WASM)** for high-performance physics and rendering.

- **Main Thread (TypeScript):** Manages the user interface, input handling, real-time plotting (uPlot), and mathematical rendering (KaTeX). The UI is implemented with custom CSS using Flexbox for layout and direct DOM manipulation for dynamic controls.
- **Simulation Worker (TypeScript/WASM):** Executes the physics engine and lattice visualization in a dedicated Web Worker to ensure UI responsiveness. Data is transferred to the main thread using **Transferable Objects** (ImageBitmap and ArrayBuffers) to minimize serialization overhead.
- **Physics Core (Rust/WASM):** Implements the Hamiltonian dynamics and state-to-image rendering.

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
- **Lattice Disks (Rust):** Individual rotors are rendered as disks. The color is determined by a **Hue-Value** mapping:
  - **Hue:** Angle $\theta \in [-\pi, \pi]$.
  - **Value/Brightness:** Kinetic energy $\omega^2$.
- **Anti-Aliasing:** A pre-computed alpha mask is applied to disks to provide smooth, anti-aliased edges without the overhead of per-pixel distance calculations.
- **Overlay Arrows (TypeScript):** Directional arrows are rendered on a separate canvas overlay using the standard 2D API, allowing for resolution-independent vector graphics on top of the WASM-generated bitmap.

### 3.2 Color Mapping
A pre-computed **Color LUT** in Rust performs high-speed conversion from (Angle, Energy) to RGBA. This avoids expensive color space conversions during the rendering pass.

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

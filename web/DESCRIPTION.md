# Technical Description: Rotor Array Simulation (Web)

This document describes the architecture, algorithms, and optimizations employed in the web implementation of the Rotor Array Simulation.

## 1. System Architecture

The application is built using a hybrid **TypeScript/Rust** architecture, leveraging **WebAssembly (WASM)** for both high-performance physics and optimized visualization.

- **Main Thread (TypeScript):** Manages the user interface, input handling, real-time plotting (uPlot), mathematical rendering (KaTeX), and the final presentation of rendered frames.
- **Simulation Worker (TypeScript/WASM):** Executes the physics engine and visualization pipeline in a dedicated Web Worker to ensure UI responsiveness. It transfers rendered `ImageBitmap` frames and raw rotor state data ($\theta$) for overlays to the main thread.
- **Physics & Visualization Core (Rust/WASM):** Implements the Hamiltonian dynamics, trigonometric look-up tables, and high-performance pixel-level rendering of the lattice.

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
The system order parameter $r = |\frac{1}{N} \sum_{j=1}^N e^{i\theta_j}|$ is computed in Rust in a single pass over the lattice to monitor phase transitions and synchronization in real-time.

## 3. Visualization & Rendering

### 3.1 WASM Rendering Pipeline
The primary visualization is performed directly in Rust for maximum performance:
- **Lattice Rendering:** Rotors are rendered as disks (when resolution allows) or solid pixels. Rust iterates over the lattice and writes directly into an RGBA pixel buffer.
- **Alpha Masking:** When the upsampling factor is sufficient ($\ge 4$), the engine applies a pre-computed anti-aliased alpha mask to each rotor disk, providing smooth circular edges.
- **Bitmap Transfer:** The resulting pixel buffer is wrapped in an `ImageData` object and converted to an `ImageBitmap` in the worker, then transferred to the main thread with zero-copy semantics.

### 3.2 Main Thread Presentation
- **Canvas Overlay:** The main thread receives the `ImageBitmap` and transfers it to the simulation canvas using `transferFromImageBitmap` (or `drawImage` as a fallback).
- **Directional Arrows:** For detailed inspection, directional arrows are rendered on a separate transparent canvas overlay using the standard 2D API, synchronized with the WASM frames.

### 3.3 Color Mapping
A consistent **Hue-Value** mapping is used to represent the state of each rotor:
- **Hue:** Represents the angle $\theta \in [-\pi, \pi]$ using a periodic color wheel.
- **Value/Brightness:** Represents kinetic energy $\omega^2$, mapped via a saturation curve to emphasize high-energy rotors.

## 4. Optimizations

### 4.1 Zero-Copy Data Transfer
- **Direct WASM Memory Access:** The TypeScript worker accesses the WASM linear memory directly using `Uint8ClampedArray` to create `ImageData` without copying pixel data.
- **ImageBitmap Transfer:** Rendering results are moved from the Worker to the Main Thread via ownership transfer, avoiding expensive data duplication across the thread boundary.

### 4.2 Computation Optimizations
- **Unsafe Indexing:** Rust code utilizes `get_unchecked` and `get_unchecked_mut` in performance-critical loops (integration and rendering) to elide bounds checks.
- **U32 Buffer Operations:** The RGBA buffer is manipulated using `u32` slice operations where possible, which is significantly faster than per-channel byte manipulation.
- **Tight Scheduling:** A `MessageChannel` is used to schedule simulation loops, bypassing the 4ms minimum clamping enforced on `setTimeout` by browsers.

## 5. Technology Stack
- **Language:** TypeScript 5.x, Rust 1.75+
- **Tooling:** Deno (Build/Tasks), wasm-bindgen (WASM FFI)
- **UI & Visualization:** uPlot (Charts), KaTeX (Math), Custom CSS Flexbox (Layout)
- **Runtime:** Modern Web Browsers (supporting Web Workers, WASM, and OffscreenCanvas)

# Rotor Array Simulation

An interactive simulation of a Hamiltonian dynamical system consisting of an $L \times L$ square array of coupled planar rotors in a uniform external field.

## Physical Model

The system consists of $N = L^2$ rotors on a 2D square lattice with periodic boundary conditions. The Hamiltonian is:

$$H = \sum_{i} \frac{1}{2} \omega_i^2 + J \sum_{\langle i,j \rangle} (1 - \cos(\theta_i - \theta_j)) - M \sum_{i} \cos(\theta_i)$$

where:
- $\theta_i$ is the angle of rotor $i$.
- $\omega_i$ is the angular velocity.
- $J$ is the coupling strength between nearest neighbors $\langle i,j \rangle$.
- $M$ is the external field strength.

## Features

- **High-Performance Physics**: 
    - **Numba**: JIT-compiled CPU kernels for fast local simulation.
    - **Taichi**: Cross-platform (Metal, CUDA, Vulkan) GPU/CPU kernels for massive scales up to $L=1000$ (1 million rotors).
    - **True Parallelism**: Multi-threaded architecture decouples physics integration from UI rendering for 60 FPS responsiveness.
- **Dynamic Visualization**:
    - **Dual Render Path**: High-performance OpenGL/Shader path and standard Pyqtgraph path.
    - **Point Mode**: Resolution-aware rendering that automatically switches to solid pixels for large lattices to eliminate Moiré artifacts.
    - **Visual Mapping**: Hue represents angle; luminance (0.4-0.8) represents kinetic energy.
- **Interactive Controls**: Real-time adjustment of $J$, $M$, time scale, and initial conditions.
- **Topological Presets**: Explore various states including Vortices, Skyrmions, and Domain Walls.
- **Real-time Monitoring**: Energy conservation tracking, relative energy drift, and order parameter history.

## Usage

Ensure you have `uv` installed, then run:

```bash
uv run main.py
```

To run unit tests:

```bash
uv run pytest
```

To run performance benchmarks:

```bash
uv run python profile_backends.py
```

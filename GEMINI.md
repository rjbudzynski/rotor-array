# Gemini Handoff - Rotor Array Simulation

This document provides a summary of the project state and guidance for future AI agents.

## Project Overview

**Rotor Array Simulation** is a Python-based interactive tool for simulating a Hamiltonian system of $L \times L$ coupled planar rotors on a square lattice in a uniform external field.

### Core Features
- **High-Fidelity Physics**: Uses a Velocity Verlet symplectic integrator with adaptive sub-stepping for energy conservation. 
- **Multi-Engine Support**: 
    - **Numba**: Optimized CPU JIT backend.
    - **Taichi**: Cross-platform GPU/CPU backend for massive scales up to $L=1000$ (1 million rotors).
- **True Parallelism**: Physics engine runs in a dedicated background thread with real-time synchronization, keeping the UI at 60 FPS.
- **Dynamic Visualization**:
    - Dual-path rendering: PyQtGraph (CPU) and **OpenGL/Shader** (GPU).
    - **Point Mode**: Resolution-aware rendering that automatically switches to solid pixels for large $L$ to eliminate Moiré artifacts.
    - **Mean Direction Visualizer**: Indicates system order parameter via a high-fidelity white arrow on a static color wheel.
- **Real-time Monitoring**: Tracks energy per rotor and relative **Energy Drift**. Displays a 10s history of both the order parameter $r$ and **Mean Kinetic Energy** $K$.

## Current State

The simulation is a feature-rich 2D square lattice rotor simulation with advanced visualization and multiple high-performance physics backends.
- **Completed**: Parallel physics architecture (QThread/Worker), Taichi GPU/CPU backend, dual visualizers (CPU/OpenGL), Point Mode rendering, and comprehensive topological presets.
- **Verification**: Fully tested for energy conservation, engine consistency, UI responsiveness, and cross-renderer stability.

## Optimization Roadmap (Ready for Implementation)
- **Numba Tiling**: Implement cache-aware loops in the Numba kernel to push CPU performance.
- **Float32 Physics**: Switch Numba integration to float32 for 2x SIMD throughput.
- **GPU Instancing**: Use hardware instancing for direction arrows to eliminate CPU overhead at large $L$.

## Key Commands
- `uv run main.py`: Start the application.
- `uv run pytest`: Run unit tests.
- `uv run python profile_backends.py`: Run performance benchmarks.
- `bd ready`: Check for available tasks in the Beads tracker.

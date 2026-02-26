# Gemini Handoff - Rotor Array Simulation

This document provides a summary of the project state and guidance for future AI agents.

## Project Overview

**Rotor Array Simulation** is a Python-based interactive tool for simulating a Hamiltonian system of $L \times L$ coupled planar rotors on a square lattice in a uniform external field.

### Core Features
- **High-Fidelity Physics**: Uses a Velocity Verlet symplectic integrator with adaptive sub-stepping for energy conservation. Supports **Numba**-accelerated CPU kernels and **Taichi**-accelerated GPU kernels for massive-scale simulation.
- **Interactive UI**: Real-time control over coupling strength ($J$), external field ($M$), time scaling, and lattice dimension ($L$).
- **Dynamic Visualization**:
    - Dual-path rendering: PyQtGraph (CPU) and **OpenGL/Shader** (GPU) for ultra-fast lattice display.
    - Lattice visualized as a grid of discs colored by state (Hue=Angle, Value=Kinetic Energy with enhanced contrast).
    - **Mean Direction Visualizer**: A static color wheel indicating the system's order parameter via a high-fidelity white arrow with black edges.
- **Real-time Monitoring**: Tracks energy per rotor and relative **Energy Drift**. Displays a 10s history of both the order parameter $r$ and **Mean Kinetic Energy** $K$.

## Current State

The simulation is a feature-rich 2D square lattice rotor simulation with advanced visualization and multiple high-performance physics backends.
- **Completed**: 2D physics engine (CPU/Numba/GPU-Taichi), dual visualizers (CPU/OpenGL), high-fidelity arrow order parameter display, and comprehensive topological presets.
- **Verification**: Fully tested for energy conservation, engine consistency, UI responsiveness, and cross-renderer stability.

## Instructions for Agents

Future agents working on this project **MUST** follow the instructions in [AGENTS.md](./AGENTS.md). 

### Key Commands
- `uv run main.py`: Start the application.
- `uv run pytest`: Run unit tests.
- `bd ready`: Check for available tasks in the Beads tracker.

## Architecture Notes
- `simulation.py`: Contains the `RotorArray` class (physics) and `SimulationEngine` (integration).
- `visualizer.py`: Contains the `RotorArrayVisualizer` class (Pyqtgraph-based grid).
- `ui.py`: Contains `ControlPanel`, `MeanDirectionVisualizer`, and `HelpDialog`.
- `main.py`: Integrates all components into the `MainWindow`.
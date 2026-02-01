# Gemini Handoff - Rotor Array Simulation

This document provides a summary of the project state and guidance for future AI agents.

## Project Overview

**Rotor Array Simulation** is a Python-based interactive tool for simulating a Hamiltonian system of $L \times L$ coupled planar rotors on a square lattice in a uniform external field.

### Core Features
- **High-Fidelity Physics**: Uses a Velocity Verlet symplectic integrator with sub-stepping for energy conservation and stability.
- **Interactive UI**: Real-time control over coupling strength ($J$), external field ($M$), and the lattice dimension ($L$). 
- **Dynamic Visualization**:
    - Lattice visualized as a grid of discs colored by state (Hue=Angle, Value=Kinetic Energy).
    - Mean Direction Visualizer: A static color wheel indicating the system's order parameter via a "slit".
- **Real-time Monitoring**: Tracks energy per rotor and displays a history of the order parameter magnitude $r$.

## Current State

The simulation has been successfully transitioned from a 1D chain to a 2D array.
- **Completed**: 2D physics engine, grid-based visualization, color wheel order parameter display, and thermalized preset enhancement.
- **Verification**: Fully tested for energy conservation and UI responsiveness.

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
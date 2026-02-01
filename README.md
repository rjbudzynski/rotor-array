# Rotor Array Simulation

An interactive simulation of a Hamiltonian dynamical system consisting of an $L \times L$ square array of coupled planar rotors in a uniform external field.

## Physical Model

The system consists of $N = L^2$ rotors on a square lattice with periodic boundary conditions in both directions. Each rotor interacts with its four nearest neighbors. The dynamics are governed by the Hamiltonian:

$$H = \frac{1}{2}\sum_{i} \omega_i^2 + J\sum_{\langle i,j \rangle} (1 - \cos(\theta_i - \theta_{j})) - M\sum_{i} \cos \theta_i$$

Where:
- $\theta_i$ is the angle of the $i$-th rotor.
- $\omega_i$ is the angular velocity.
- $J$ is the nearest-neighbor coupling constant.
- $M$ is the strength of the uniform external field.
- $\langle i,j \rangle$ denotes summation over nearest-neighbor pairs on the lattice.

The equations of motion are:
- $\dot{\theta}_i = \omega_i$
- $\dot{\omega}_i = -J\sum_{j \in \text{neighbors}(i)} \sin(\theta_i - \theta_j) - M\sin \theta_i$

## Implementation

- **Core**: Python 3.13 with NumPy for numerical operations and a custom **Velocity Verlet** symplectic integrator for energy-conserving dynamics.
    - Uses sub-stepping (default 10x) per UI frame to maintain stability.
- **Visualization**: Pyqtgraph-based display representing rotors as an $L \times L$ grid of discs.
    - **Hue**: Maps to the rotor angle $\theta_i$.
    - **Luminosity**: Proportional to the kinetic energy $\omega_i^2$.
    - Includes a dedicated **Mean Direction Visualizer** (order parameter) as a static color wheel with a direction slit.
- **UI**: PyQt6 interface providing:
    - Interactive sliders for $J$ and $M$.
    - Selection of initial condition presets:
        - **Random Angles**: High entropy start.
        - **Twisted**: Topological winding state along the horizontal axis.
        - **Domain Wall**: Relaxation from a split configuration.
        - **Single Kick**: Perturbation of a single rotor at position (0,0).
        - **Thermalized**: Random initial velocities scaled by mean energy $\epsilon$.
    - Dynamic control of the lattice side length $L$.
    - Real-time monitoring of energy per rotor and the order parameter history.
- **Testing**: Comprehensive suite covering physics, engine stability, and UI automation.

## Usage

Ensure you have `uv` installed, then run:

```bash
uv run main.py
```

To run unit tests:

```bash
uv run pytest
```
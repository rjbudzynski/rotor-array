# Rotor Array Simulation - Help

This application simulates an $L \times L$ square array of coupled planar rotors on a square lattice, subjected to a uniform external field with periodic boundary conditions.

## Physics Overview

The system consists of $N = L^2$ rotors. Each rotor interacts with its four nearest neighbors (top, bottom, left, right) via a coupling constant $J$ and responds to an external field $M$ aligned with the vertical downward direction.

- **Coupling (J)**: Determines the strength of alignment between neighbors. Large $J$ favors synchronization.
- **Field (M)**: Determines the alignment strength with the external field ($\theta = 0$, pointing down).
- **Order Parameter (r)**: Measures the synchronization of the system.
    - $r \approx 1$: High synchronization (aligned).
    - $r \approx 0$: High entropy (random orientations).

## Controls

### Simulation Parameters
- **Lattice Side (L)**: Dimension of the square lattice ($N = L^2$). (Adjustable only when stopped).
- **Initial Condition Presets**:
    - **Random Angles**: High entropy initial state.
    - **Twisted**: Topological winding state. Set the winding number **k**.
    - **Domain Wall**: Split configuration at $0$ and $\pi$.
    - **Pi/2 Domain Wall**: Split configuration at $\pm\pi/2$.
    - **Vortex Band**: A band of phase ramps. Adjust **Width (w)** and **Shift (\u03b4\u03c6)**.
    - **Cross Domain**: Four triangular domains meeting at the center.
    - **Vortex Pair**: A vortex and antivortex at a set **Separation**.
    - **Skyrmion**: A localized phase twist with a defined **Radius (\u03c3)**.
    - **Single Kick**: A localized Gaussian velocity kick.
    - **Thermalized**: Velocities assigned based on **Mean Energy (\u03b5)**.
- **Initial Temp (T)**: Overlay random noise (phonons) on any preset.
- **Time Scale**: Adjust the speed of the simulation (0.1x to 5.0x).

### Advanced Options
- **Show Direction Arrows**: Overlays arrows on the rotors for precise orientation tracking (auto-disabled for $L > 60$).
- **Numba Acceleration**: Uses JIT-compiled kernels for significantly faster physics integration.
- **OpenGL Renderer**: Uses GPU shaders for ultra-high-performance visualization of large lattices.

## Monitors & Analytics

- **Energy per Rotor**: Total energy ($H/N$). Should be conserved when parameters are constant.
- **Energy Drift**: Relative change in total energy from the initial state, used to monitor numerical stability.
- **Mean Direction**: A color wheel indicating the system's average orientation. The **White Arrow** indicates the magnitude ($r$) and direction of the order parameter.
- **Dynamic Chart**: Shows the 10-second history of:
    - **Order Parameter r** (Yellow): System synchronization.
    - **Mean Kinetic K** (Cyan): Average rotational energy per rotor.

## Visualization
- **Hue**: Maps directly to rotor angle $\theta$. **Blue** aligns with the downward external field.
- **Luminosity**: Maps to kinetic energy ($\omega^2$). Brighter discs are moving faster. High-contrast mapping ensures even small energy fluctuations are visible.
- **Coordinate System**: $\theta = 0$ is down; $\theta = \pi/2$ is right.

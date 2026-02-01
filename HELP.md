# Rotor Array Simulation - Help

This application simulates an $L \times L$ square array of coupled planar rotors subjected to a uniform external field, with periodic boundary conditions in both directions.

## Physics Overview

The system consists of $N = L^2$ rotors on a square lattice. Each rotor interacts with its four nearest neighbors via a coupling constant $J$ and responds to an external field $M$.

- **Coupling (J)**: Determines how strongly rotors want to align with their neighbors.
- **Field (M)**: Determines how strongly rotors want to align with the vertical downward direction.
- **Order Parameter (r)**: Measures the synchronization of the system. A value of 1.0 means all rotors are perfectly aligned.

## Controls

### Simulation Parameters
- **Lattice Side (L)**: Adjust the dimension of the square lattice. (Changeable only when paused).
- **Initial Condition Preset**: Choose a starting configuration:
    - **Random Angles**: High entropy start.
    - **Twisted**: Creates a topological winding state along the horizontal direction. Use **Winding (k)** to set the number of full rotations across the lattice.
    - **Domain Wall**: Split configuration (left/right) to observe relaxation.
    - **Single Kick**: One rotor (at position 0,0) is given an initial velocity. Use **Velocity (\u03c9)** to set the magnitude.
    - **Thermalized**: Random velocities (Maxwell-Boltzmann like) assigned to rotors at zero angle.
- **Coupling (J)**: Real-time slider for neighbor interaction strength.
- **Field (M)**: Real-time slider for external field strength.

### Controls & Monitors
- **Start/Stop**: Runs or pauses the integration.
- **Reset**: Restores initial conditions and stops the timer.
- **Energy per Rotor**: Monitors numerical stability. In a closed system ($M=0$ or constant parameters), this should be conserved.
- **Order Parameter Plot**: Shows the history of system synchronization over the last 10 seconds.

## Visualization
- **L x L Grid of Discs**: Each disc represents a rotor.
- **Hue**: The color hue represents the rotor's angular variable $\theta_i \in [0, 2\pi)$.
- **Luminosity**: Brighter colors indicate higher kinetic energy ($\omega_i^2$). Zero energy corresponds to a dim but visible state.
- **Discs at Rest**: Will appear with their orientation-dependent hue but low luminosity.

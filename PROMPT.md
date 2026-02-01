**Simulation of Coupled Rotors on a Lattice**

# Starting point

The current folder contains a mostly feature complete implementation of a chain
of planar rotors with:

* periodic boundary conditions
* nearest neighbor coupling 
* coupling to a uniform external field
* dynamic visualization of the system state
* dynamically updating plot of the order parameter in time
* interactive controls for setting model parameters and initial conditions

# The task

Based on this code, develop a simulation with analogous features, but modeling 
an array of rotors. The $N = L^2$  rotors will live on the nodes of a $L\times L$
square lattice, with periodicity in both directions, and will be coupled 
analogously to the rotors in the original chain, each to all four nearest neighbors--
those joined by single lattice links.

The visualization will consist of a $L\times L$ array of discs, which will be colored
according to the value of the corresponding rotor's angular variable, mapped
to the hue of the disc in HSL color coordinates. The luminosity should be
proportional to the rotor's kinetic energy (essentially velocity squared), but with
zero energy corresponding to a small but nonzero luminosity, to avoid the discs
becoming completely black when at rest.

# Tools and Workflow

Observe the same rules as in the original project, as outlined in @AGENTS.md.
Each major step should be preceeded by fleshing out the implementation as beads
issues, with properly declared dependencies. Do **NOT** proceed to commit work
until all test have passed and the code was confirmed to compile.

Clean out unused code from the original project when no longer needed for reference.

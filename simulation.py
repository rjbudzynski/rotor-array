import numpy as np
from scipy.integrate import solve_ivp
from typing import NamedTuple, Tuple

class SimulationParams(NamedTuple):
    """Parameters for the rotor array simulation."""
    l_side: int
    j_coupling: float
    m_field: float

    @property
    def n_rotors(self) -> int:
        return self.l_side**2

class RotorArray:
    """
    Represents an L x L array of coupled planar rotors on a square lattice.
    
    The Hamiltonian is given by:
    H = 1/2 * sum(omega_i^2) + J * sum_{<i,j>} (1 - cos(theta_i - theta_j)) - M * sum(cos(theta_i))
    where <i,j> denotes nearest neighbors on the square lattice.
    """

    def __init__(self, params: SimulationParams):
        """
        Initialize the rotor array with given parameters.
        
        Args:
            params: The physical parameters of the system.
        """
        self.params = params

    def get_acceleration(self, theta: np.ndarray) -> np.ndarray:
        """
        Calculate the acceleration (d_omega/dt) for given angles.
        """
        l = self.params.l_side
        theta_2d = theta.reshape(l, l)
        
        # Periodic neighbors
        t_up = np.roll(theta_2d, -1, axis=0)
        t_down = np.roll(theta_2d, 1, axis=0)
        t_left = np.roll(theta_2d, -1, axis=1)
        t_right = np.roll(theta_2d, 1, axis=1)
        
        # Forces from 4 neighbors: -dU/d_theta
        # For a single bond: -d/d_theta_i [ J(1 - cos(theta_i - theta_j)) ] = -J * sin(theta_i - theta_j)
        force = -(np.sin(theta_2d - t_up) + 
                  np.sin(theta_2d - t_down) + 
                  np.sin(theta_2d - t_left) + 
                  np.sin(theta_2d - t_right))
        
        accel = self.params.j_coupling * force - self.params.m_field * np.sin(theta_2d)
        return accel.flatten()

    def equations_of_motion(self, t: float, y: np.ndarray) -> np.ndarray:
        """
        Calculate the time derivatives of the state vector.
        """
        n = self.params.n_rotors
        theta = y[:n]
        omega = y[n:]
        
        d_theta = omega
        d_omega = self.get_acceleration(theta)
        
        return np.concatenate([d_theta, d_omega])

    def hamiltonian(self, y: np.ndarray) -> float:
        """
        Calculate the Hamiltonian (total energy) of the system.
        """
        n = self.params.n_rotors
        l = self.params.l_side
        theta = y[:n]
        omega = y[n:]
        theta_2d = theta.reshape(l, l)
        
        kinetic = 0.5 * np.sum(omega**2)
        
        # Potential term: J * sum(1 - cos(delta_theta)) over unique bonds
        t_up = np.roll(theta_2d, -1, axis=0)
        t_left = np.roll(theta_2d, -1, axis=1)
        
        pot_up = np.sum(1 - np.cos(theta_2d - t_up))
        pot_left = np.sum(1 - np.cos(theta_2d - t_left))
        potential = self.params.j_coupling * (pot_up + pot_left)
        
        # Field term: -M * sum(cos(theta_i))
        field = -self.params.m_field * np.sum(np.cos(theta))
        
        return kinetic + potential + field

class OrderParameter(NamedTuple):
    """Result of the phase order parameter calculation."""
    r: float
    mean_cos: float
    mean_sin: float

class SimulationEngine:
    """
    Manages the physical state and integration of the rotor array simulation.
    """
    
    def __init__(self, params: SimulationParams):
        self.params = params
        self.array = RotorArray(params)
        self.y = np.zeros(2 * params.n_rotors)
        self.t = 0.0
        # Adaptive sub-stepping parameters
        self.adaptive_substepping = True
        self.substeps = 10
        self.stability_factor = 0.006
        
    def set_state(self, y: np.ndarray, t: float = 0.0):
        """Set the current state of the simulation."""
        self.y = y.copy()
        self.t = t
        
    def update_params(self, j: float = None, m: float = None):
        """Update simulation parameters without resetting the state."""
        l = self.params.l_side
        j = j if j is not None else self.params.j_coupling
        m = m if m is not None else self.params.m_field
        self.params = SimulationParams(l_side=l, j_coupling=j, m_field=m)
        self.array.params = self.params

    def verlet_step(self, dt: float):
        """
        Perform a single Velocity Verlet step.
        """
        n = self.params.n_rotors
        theta = self.y[:n]
        omega = self.y[n:]
        
        # 1. v(t + dt/2) = v(t) + a(t) * dt/2
        accel_t = self.array.get_acceleration(theta)
        omega_mid = omega + accel_t * (dt / 2.0)
        
        # 2. x(t + dt) = x(t) + v(t + dt/2) * dt
        theta_new = theta + omega_mid * dt
        
        # 3. v(t + dt) = v(t + dt/2) + a(t + dt) * dt/2
        accel_new = self.array.get_acceleration(theta_new)
        omega_new = omega_mid + accel_new * (dt / 2.0)
        
        self.y[:n] = theta_new
        self.y[n:] = omega_new
        self.t += dt

    def step(self, dt: float) -> bool:
        """
        Advance the simulation by dt using sub-stepping with Verlet.
        If adaptive_substepping is True, calculates substeps to maintain stability.
        """
        if self.adaptive_substepping:
            # Highest frequency mode approx sqrt(8J + M) for 2D square lattice
            j = self.params.j_coupling
            m = self.params.m_field
            omega_max = np.sqrt(8.0 * abs(j) + abs(m) + 1e-9)
            
            # Stability limit for Velocity Verlet is omega_max * sub_dt < 2.
            # We use a much smaller value for energy conservation.
            self.substeps = max(1, int(np.ceil(dt * omega_max / self.stability_factor)))
        
        sub_dt = dt / self.substeps
        for _ in range(self.substeps):
            self.verlet_step(sub_dt)
        return True

    @property
    def theta(self) -> np.ndarray:
        return self.y[:self.params.n_rotors]

    @property
    def omega(self) -> np.ndarray:
        return self.y[self.params.n_rotors:]
    
    def get_energy(self) -> float:
        """Calculate total energy of the current state."""
        return self.array.hamiltonian(self.y)
    
    def get_order_parameter(self) -> OrderParameter:
        """Calculate the phase order parameter r and its components."""
        theta = self.theta
        mean_cos = np.mean(np.cos(theta))
        mean_sin = np.mean(np.sin(theta))
        r = np.sqrt(mean_cos**2 + mean_sin**2)
        return OrderParameter(r, mean_cos, mean_sin)


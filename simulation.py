import numpy as np


class SimulationParams:
    """Parameters for the rotor array simulation."""

    def __init__(self, l_side: int, j_coupling: float, m_field: float):
        self.l_side = l_side
        self.j_coupling = j_coupling
        self.m_field = m_field

    @property
    def n_rotors(self) -> int:
        return self.l_side**2


def validate_params(l_side: int, j_coupling: float, m_field: float) -> None:
    """Validate simulation parameters."""
    if not isinstance(l_side, int):
        raise TypeError(f"l_side must be int, got {type(l_side)}")
    if l_side <= 0:
        raise ValueError(f"Lattice side must be positive, got {l_side}")
    if not np.isfinite(j_coupling):
        raise ValueError(f"Coupling J must be finite, got {j_coupling}")
    if not np.isfinite(m_field):
        raise ValueError(f"Field M must be finite, got {m_field}")


class RotorArray:
    """
    Represents an L x L array of coupled planar rotors on a square lattice.
    """

    def __init__(self, params: SimulationParams):
        validate_params(params.l_side, params.j_coupling, params.m_field)
        self.params = params

    def get_acceleration(self, theta: np.ndarray) -> np.ndarray:
        expected_n = self.params.n_rotors
        if theta.size != expected_n:
            raise ValueError(f"theta must have {expected_n} elements, got {theta.size}")

        l_side = self.params.l_side
        j = self.params.j_coupling
        m = self.params.m_field
        theta_2d = theta.reshape(l_side, l_side)

        diff_h = theta_2d - np.roll(theta_2d, -1, axis=1)
        sin_h = np.sin(diff_h)
        force_h = sin_h - np.roll(sin_h, 1, axis=1)

        diff_v = theta_2d - np.roll(theta_2d, -1, axis=0)
        sin_v = np.sin(diff_v)
        force_v = sin_v - np.roll(sin_v, 1, axis=0)

        accel_2d = -j * (force_h + force_v)

        if m != 0:
            accel_2d -= m * np.sin(theta_2d)

        return accel_2d.flatten()

    def equations_of_motion(self, t: float, y: np.ndarray) -> np.ndarray:
        n = self.params.n_rotors
        theta = y[:n]
        omega = y[n:]

        d_theta = omega
        d_omega = self.get_acceleration(theta)

        return np.concatenate([d_theta, d_omega])

    def hamiltonian(self, y: np.ndarray) -> float:
        n = self.params.n_rotors
        l_side = self.params.l_side
        theta = y[:n]
        omega = y[n:]
        theta_2d = theta.reshape(l_side, l_side)

        kinetic = 0.5 * np.sum(omega**2)

        t_up = np.roll(theta_2d, -1, axis=0)
        t_left = np.roll(theta_2d, -1, axis=1)

        pot_up = np.sum(1 - np.cos(theta_2d - t_up))
        pot_left = np.sum(1 - np.cos(theta_2d - t_left))
        potential = self.params.j_coupling * (pot_up + pot_left)

        field = -self.params.m_field * np.sum(np.cos(theta))

        return kinetic + potential + field


class OrderParameter:
    def __init__(self, r: float, mean_cos: float, mean_sin: float):
        self.r = r
        self.mean_cos = mean_cos
        self.mean_sin = mean_sin


class SimulationEngine:
    def __init__(self, params: SimulationParams):
        self.params = params
        self.array = RotorArray(params)
        self.y = np.zeros(2 * params.n_rotors)
        self.t = 0.0
        self.adaptive_substepping = True
        self.substeps = 10
        self.stability_factor = 0.006
        self._accel: np.ndarray | None = None

    def set_state(self, y: np.ndarray, t: float = 0.0) -> None:
        self.y = y.copy()
        self.t = float(t)
        self._accel = None

    def update_params(self, j: float | None = None, m: float | None = None) -> None:
        l_side = self.params.l_side
        j_val = j if j is not None else self.params.j_coupling
        m_val = m if m is not None else self.params.m_field
        self.params = SimulationParams(l_side=l_side, j_coupling=j_val, m_field=m_val)
        self.array.params = self.params
        self._accel = None

    def verlet_step(self, dt: float) -> None:
        n = self.params.n_rotors
        theta = self.y[:n]
        omega = self.y[n:]

        if self._accel is None:
            self._accel = self.array.get_acceleration(theta)

        omega_mid = omega + self._accel * (dt / 2.0)
        theta_new = theta + omega_mid * dt
        theta_new = (theta_new + np.pi) % (2 * np.pi) - np.pi

        self._accel = self.array.get_acceleration(theta_new)
        omega_new = omega_mid + self._accel * (dt / 2.0)

        self.y[:n] = theta_new
        self.y[n:] = omega_new
        self.t += dt

    def step(self, dt: float) -> bool:
        if self.adaptive_substepping:
            j = self.params.j_coupling
            m = self.params.m_field
            omega_max = np.sqrt(8.0 * abs(j) + abs(m) + 1e-9)
            self.substeps = max(1, int(np.ceil(dt * omega_max / self.stability_factor)))

        sub_dt = dt / self.substeps
        for _ in range(self.substeps):
            self.verlet_step(sub_dt)
        return True

    @property
    def theta(self) -> np.ndarray:
        return self.y[: self.params.n_rotors]

    @property
    def omega(self) -> np.ndarray:
        return self.y[self.params.n_rotors :]

    def get_energy(self) -> float:
        return self.array.hamiltonian(self.y)

    def get_order_parameter(self) -> OrderParameter:
        theta = self.theta
        mean_cos = float(np.mean(np.cos(theta)))
        mean_sin = float(np.mean(np.sin(theta)))
        r = float(np.sqrt(mean_cos**2 + mean_sin**2))
        return OrderParameter(r, mean_cos, mean_sin)

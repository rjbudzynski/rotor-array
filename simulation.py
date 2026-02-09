import numpy as np

try:
    import numba as nb
except Exception:  # pragma: no cover - optional dependency
    nb = None


def _build_numba_kernel():
    if nb is None:
        return None

    @nb.njit(cache=True, fastmath=True, parallel=True)
    def accel_kernel(theta: np.ndarray, l_side: int, j: float, m: float, out: np.ndarray) -> None:
        theta_2d = theta.reshape((l_side, l_side))
        out_2d = out.reshape((l_side, l_side))
        for r in nb.prange(l_side):
            r_up = r - 1 if r > 0 else l_side - 1
            r_dn = r + 1 if r + 1 < l_side else 0
            for c in range(l_side):
                c_lt = c - 1 if c > 0 else l_side - 1
                c_rt = c + 1 if c + 1 < l_side else 0
                theta_rc = theta_2d[r, c]
                force = (
                    np.sin(theta_rc - theta_2d[r, c_rt])
                    + np.sin(theta_rc - theta_2d[r, c_lt])
                    + np.sin(theta_rc - theta_2d[r_dn, c])
                    + np.sin(theta_rc - theta_2d[r_up, c])
                )
                accel = -j * force
                if m != 0.0:
                    accel -= m * np.sin(theta_rc)
                out_2d[r, c] = accel

    return accel_kernel


_ACCEL_KERNEL = _build_numba_kernel()
NUMBA_AVAILABLE = _ACCEL_KERNEL is not None


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

    def __init__(self, params: SimulationParams, use_numba: bool = False):
        validate_params(params.l_side, params.j_coupling, params.m_field)
        self.params = params
        self.use_numba = use_numba
        self._accel_buf: np.ndarray | None = None

        if self.use_numba and _ACCEL_KERNEL is None:
            raise ImportError("numba is not available; install numba to enable use_numba.")

    def get_acceleration(self, theta: np.ndarray) -> np.ndarray:
        expected_n = self.params.n_rotors
        if theta.size != expected_n:
            raise ValueError(f"theta must have {expected_n} elements, got {theta.size}")

        l_side = self.params.l_side
        j = self.params.j_coupling
        m = self.params.m_field

        if self.use_numba:
            if self._accel_buf is None or self._accel_buf.size != theta.size:
                self._accel_buf = np.empty_like(theta)
            _ACCEL_KERNEL(theta, l_side, j, m, self._accel_buf)
            return self._accel_buf

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
    def __init__(self, params: SimulationParams, use_numba: bool = False):
        self.params = params
        self.use_numba = use_numba
        self.array = RotorArray(params, use_numba=use_numba)
        self.y = np.zeros(2 * params.n_rotors)
        self.t = 0.0
        self.adaptive_substepping = True
        self.substeps = 10
        self.stability_factor = 0.006
        self._accel: np.ndarray | None = None

    def set_state(self, y: np.ndarray, t: float = 0.0) -> None:
        expected = 2 * self.params.n_rotors
        if y.size != expected:
            raise ValueError(f"state must have {expected} elements, got {y.size}")
        if not np.all(np.isfinite(y)):
            raise ValueError("state contains non-finite values")
        self.y = y.copy()
        self.t = float(t)
        self._accel = None

    def update_params(self, j: float | None = None, m: float | None = None) -> None:
        l_side = self.params.l_side
        j_val = j if j is not None else self.params.j_coupling
        m_val = m if m is not None else self.params.m_field
        validate_params(l_side=l_side, j_coupling=j_val, m_field=m_val)
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
            omega_max = max(omega_max, float(np.max(np.abs(self.omega)) + 1e-9))
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

import numpy as np

try:
    import taichi as ti

    # Attempt to initialize Taichi. Default to GPU, fallback to CPU.
    # We use a try-except because some environments might fail ti.init()
    ti.init(arch=ti.gpu, log_level=ti.WARN)
    TAICHI_AVAILABLE = True
except Exception:
    ti = None
    TAICHI_AVAILABLE = False

from simulation import OrderParameter, SimulationParams

if TAICHI_AVAILABLE:

    @ti.data_oriented
    class TaichiRotorArray:
        """
        GPU-accelerated implementation of the Rotor Array physics using Taichi.
        """

        def __init__(self, l_side: int, j: float, m: float):
            self.l_side = l_side
            self.n = l_side * l_side

            # Fields (GPU memory)
            self.theta = ti.field(dtype=ti.f32, shape=(l_side, l_side))
            self.omega = ti.field(dtype=ti.f32, shape=(l_side, l_side))
            self.accel = ti.field(dtype=ti.f32, shape=(l_side, l_side))

            # Parameters
            self.j = ti.field(dtype=ti.f32, shape=())
            self.m = ti.field(dtype=ti.f32, shape=())
            self.j[None] = j
            self.m[None] = m

            # Reduction fields for stats
            self.sum_cos = ti.field(dtype=ti.f32, shape=())
            self.sum_sin = ti.field(dtype=ti.f32, shape=())
            self.sum_ke = ti.field(dtype=ti.f32, shape=())
            self.sum_pe = ti.field(dtype=ti.f32, shape=())

        @ti.kernel
        def compute_acceleration(self):
            for i, j in self.theta:
                i_up = (i - 1 + self.l_side) % self.l_side
                i_dn = (i + 1) % self.l_side
                j_lt = (j - 1 + self.l_side) % self.l_side
                j_rt = (j + 1) % self.l_side

                theta_curr = self.theta[i, j]
                # Neighbors: Right, Left, Down, Up
                force = (
                    ti.sin(theta_curr - self.theta[i, j_rt])
                    + ti.sin(theta_curr - self.theta[i, j_lt])
                    + ti.sin(theta_curr - self.theta[i_dn, j])
                    + ti.sin(theta_curr - self.theta[i_up, j])
                )

                self.accel[i, j] = -self.j[None] * force - self.m[None] * ti.sin(theta_curr)

        @ti.kernel
        def verlet_step_1(self, dt: ti.f32):
            """First half of Velocity Verlet + position update."""
            for i, j in self.theta:
                self.omega[i, j] += self.accel[i, j] * dt * 0.5
                self.theta[i, j] += self.omega[i, j] * dt

                # Wrap theta to [-pi, pi]
                # ti.fmod(a, b) in Taichi is like C fmod
                val = self.theta[i, j] + ti.math.pi
                two_pi = 2.0 * ti.math.pi
                wrapped = val - ti.floor(val / two_pi) * two_pi
                self.theta[i, j] = wrapped - ti.math.pi

        @ti.kernel
        def verlet_step_2(self, dt: ti.f32):
            """Second half of Velocity Verlet."""
            for i, j in self.theta:
                self.omega[i, j] += self.accel[i, j] * dt * 0.5

        @ti.kernel
        def compute_stats(self):
            """Compute sums for energy and order parameter in one pass."""
            self.sum_cos[None] = 0.0
            self.sum_sin[None] = 0.0
            self.sum_ke[None] = 0.0
            self.sum_pe[None] = 0.0

            for i, j in self.theta:
                t = self.theta[i, j]
                w = self.omega[i, j]

                # Order parameter components
                ti.atomic_add(self.sum_cos[None], ti.cos(t))
                ti.atomic_add(self.sum_sin[None], ti.sin(t))

                # Kinetic energy
                ti.atomic_add(self.sum_ke[None], 0.5 * w * w)

                # Potential energy (neighbors)
                i_dn = (i + 1) % self.l_side
                j_rt = (j + 1) % self.l_side
                ti.atomic_add(self.sum_pe[None], self.j[None] * (1.0 - ti.cos(t - self.theta[i_dn, j])))
                ti.atomic_add(self.sum_pe[None], self.j[None] * (1.0 - ti.cos(t - self.theta[i, j_rt])))

                # Field energy
                ti.atomic_add(self.sum_pe[None], -self.m[None] * ti.cos(t))

        def set_state(self, theta: np.ndarray, omega: np.ndarray):
            self.theta.from_numpy(theta.reshape(self.l_side, self.l_side).astype(np.float32))
            self.omega.from_numpy(omega.reshape(self.l_side, self.l_side).astype(np.float32))

        def get_theta(self) -> np.ndarray:
            return self.theta.to_numpy().flatten()

        def get_omega(self) -> np.ndarray:
            return self.omega.to_numpy().flatten()

    class TaichiSimulationEngine:
        """
        Simulation engine using Taichi backend.
        """

        def __init__(self, params: SimulationParams):
            self.params = params
            self.array = TaichiRotorArray(params.l_side, params.j_coupling, params.m_field)
            self.t = 0.0
            self.substeps = 10
            self._initial_energy = 0.0

        def set_state(self, y: np.ndarray, t: float = 0.0):
            n = self.params.n_rotors
            theta = y[:n]
            omega = y[n:]
            self.array.set_state(theta, omega)
            self.t = t
            self.array.compute_acceleration()

        def update_params(self, j: float | None = None, m: float | None = None):
            if j is not None:
                self.array.j[None] = j
            if m is not None:
                self.array.m[None] = m

        def step(self, dt: float) -> bool:
            sub_dt = dt / self.substeps
            for _ in range(self.substeps):
                # Velocity Verlet step
                self.array.verlet_step_1(sub_dt)
                self.array.compute_acceleration()
                self.array.verlet_step_2(sub_dt)
            self.t += dt
            return True

        def get_energy(self) -> float:
            self.array.compute_stats()
            return float(self.array.sum_ke[None] + self.array.sum_pe[None])

        def get_mean_kinetic_energy(self) -> float:
            self.array.compute_stats()
            return float(self.array.sum_ke[None] / self.params.n_rotors)

        def get_order_parameter(self) -> OrderParameter:
            self.array.compute_stats()
            n = self.params.n_rotors
            mean_cos = float(self.array.sum_cos[None] / n)
            mean_sin = float(self.array.sum_sin[None] / n)
            r = float(np.sqrt(mean_cos**2 + mean_sin**2))
            return OrderParameter(r, mean_cos, mean_sin)

        @property
        def theta(self) -> np.ndarray:
            return self.array.get_theta()

        @property
        def omega(self) -> np.ndarray:
            return self.array.get_omega()
else:
    class TaichiSimulationEngine:
        def __init__(self, params):
            raise ImportError("Taichi is not available or failed to initialize.")

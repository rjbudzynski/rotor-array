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
            self.stats_dirty = True

        @ti.kernel
        def compute_acceleration(self):
            for i, j in self.theta:
                # Fast periodic boundaries without modulo
                i_up = i - 1 if i > 0 else self.l_side - 1
                i_dn = i + 1 if i + 1 < self.l_side else 0
                j_lt = j - 1 if j > 0 else self.l_side - 1
                j_rt = j + 1 if j + 1 < self.l_side else 0

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
        def verlet_half_step_omega(self, dt: ti.f32):
            """Half step update for omega."""
            for i, j in self.theta:
                self.omega[i, j] += self.accel[i, j] * dt * 0.5

        @ti.kernel
        def verlet_full_step_theta(self, dt: ti.f32):
            """Full step update for theta with wrapping."""
            for i, j in self.theta:
                self.theta[i, j] += self.omega[i, j] * dt

                # Wrap theta to [-pi, pi]
                val = self.theta[i, j] + ti.math.pi
                two_pi = 2.0 * ti.math.pi
                wrapped = val - ti.floor(val / two_pi) * two_pi
                self.theta[i, j] = wrapped - ti.math.pi

        @ti.kernel
        def compute_stats_kernel(self):
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

                # Potential energy (neighbors) - only Down and Right to avoid double counting
                i_dn = i + 1 if i + 1 < self.l_side else 0
                j_rt = j + 1 if j + 1 < self.l_side else 0
                
                ti.atomic_add(self.sum_pe[None], self.j[None] * (1.0 - ti.cos(t - self.theta[i_dn, j])))
                ti.atomic_add(self.sum_pe[None], self.j[None] * (1.0 - ti.cos(t - self.theta[i, j_rt])))

                # Field energy
                ti.atomic_add(self.sum_pe[None], -self.m[None] * ti.cos(t))

        def compute_stats(self):
            if self.stats_dirty:
                self.compute_stats_kernel()
                self.stats_dirty = False

        @ti.kernel
        def copy_to_buffer(self, buf: ti.types.ndarray()):
            for i, j in self.theta:
                idx = (i * self.l_side + j) * 2
                buf[idx] = self.theta[i, j]
                buf[idx + 1] = self.omega[i, j]

        def set_state(self, theta: np.ndarray, omega: np.ndarray):
            self.theta.from_numpy(theta.reshape(self.l_side, self.l_side).astype(np.float32))
            self.omega.from_numpy(omega.reshape(self.l_side, self.l_side).astype(np.float32))
            self.stats_dirty = True

        def get_theta(self) -> np.ndarray:
            return self.theta.to_numpy().flatten()

        def get_omega(self) -> np.ndarray:
            return self.omega.to_numpy().flatten()

        def get_state(self) -> np.ndarray:
            """Get combined theta and omega in a single transfer if possible, or consistent format."""
            # Currently Taichi fields require separate to_numpy() calls
            # unless we pack them into a single dual-channel field.
            # We'll stick to concatenated for now but minimize the calls.
            return np.concatenate([self.get_theta(), self.get_omega()])

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
            self._pbos = []
            self._pbo_idx = 0

        def set_pbos(self, pbos: list[int]):
            """Set the OpenGL PBO IDs for zero-copy rendering."""
            self._pbos = pbos

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
            self.array.stats_dirty = True

        def step(self, dt: float) -> bool:
            sub_dt = dt / self.substeps
            
            # Optimized Velocity Verlet:
            # 1. Half step omega (kick)
            # 2. Loop:
            #    a. Full step theta (drift)
            #    b. Compute acceleration (new forces)
            #    c. Full step omega (double kick)
            # 3. Last Half step omega (kick)
            
            # This reduces kernel launches by consolidating steps.
            self.array.verlet_half_step_omega(sub_dt)
            
            for i in range(self.substeps):
                self.array.verlet_full_step_theta(sub_dt)
                self.array.compute_acceleration()
                if i < self.substeps - 1:
                    # Full kick for internal steps
                    self.array.verlet_half_step_omega(sub_dt * 2.0)
                else:
                    # Final half kick
                    self.array.verlet_half_step_omega(sub_dt)
            
            self.t += dt
            self.array.stats_dirty = True

            # If zero-copy PBOs are available, write directly to them
            if self._pbos:
                # Use current PBO
                pbo = self._pbos[self._pbo_idx]
                self._pbo_idx = (self._pbo_idx + 1) % 2
                # TODO: Implement direct pointer map or ExternalArray sync
            
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

        def get_state(self) -> np.ndarray:
            return self.array.get_state()

        @property
        def y(self) -> np.ndarray:
            return self.get_state()
else:
    class TaichiSimulationEngine:
        def __init__(self, params):
            raise ImportError("Taichi is not available or failed to initialize.")

import numpy as np

# Global state for Taichi status
TAICHI_AVAILABLE = False
ti = None

try:
    import taichi as ti
    TAICHI_AVAILABLE = True
except ImportError:
    ti = None
    TAICHI_AVAILABLE = False

def init_taichi(use_gpu: bool = True) -> bool:
    """Initialize Taichi with the specified backend. Should be called before engine instantiation."""
    global TAICHI_AVAILABLE, ti
    if not TAICHI_AVAILABLE:
        return False
    try:
        arch = ti.gpu if use_gpu else ti.cpu
        # log_level=ti.WARN to keep console clean
        ti.init(arch=arch, log_level=ti.WARN)
        return True
    except Exception:
        # Fallback to CPU if GPU fails
        try:
            ti.init(arch=ti.cpu, log_level=ti.WARN)
            return True
        except Exception:
            TAICHI_AVAILABLE = False
            return False

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

            # State fields (allocated on current Taichi backend)
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

            # Pre-mapped RGBA buffer for fast visualization
            self.rgba_field = ti.Vector.field(4, dtype=ti.u8, shape=(l_side, l_side))

        @ti.func
        def get_accel(self, i, j):
            # Fast periodic boundaries
            i_up = i - 1 if i > 0 else self.l_side - 1
            i_dn = i + 1 if i + 1 < self.l_side else 0
            j_lt = j - 1 if j > 0 else self.l_side - 1
            j_rt = j + 1 if j + 1 < self.l_side else 0

            theta_curr = self.theta[i, j]
            force = (
                ti.sin(theta_curr - self.theta[i, j_rt])
                + ti.sin(theta_curr - self.theta[i, j_lt])
                + ti.sin(theta_curr - self.theta[i_dn, j])
                + ti.sin(theta_curr - self.theta[i_up, j])
            )
            return -self.j[None] * force - self.m[None] * ti.sin(theta_curr)

        @ti.kernel
        def update_acceleration(self):
            for i, j in self.theta:
                self.accel[i, j] = self.get_accel(i, j)

        @ti.kernel
        def verlet_half_step_omega(self, dt: ti.f32):
            for i, j in self.theta:
                self.omega[i, j] += self.accel[i, j] * dt * 0.5

        @ti.kernel
        def verlet_full_step_theta(self, dt: ti.f32):
            for i, j in self.theta:
                self.theta[i, j] += self.omega[i, j] * dt
                val = self.theta[i, j] + ti.math.pi
                # Robust wrapping
                self.theta[i, j] = (val % (2.0 * ti.math.pi)) - ti.math.pi

        @ti.kernel
        def map_colors(self, val_min: ti.f32, val_max: ti.f32):
            for i, j in self.theta:
                t = self.theta[i, j]
                w = self.omega[i, j]
                
                # 1. Hue mapping
                hue = ((t + 4.18879020478) % 6.28318530718) / 6.28318530718
                
                # 2. Value mapping
                energy = w * w
                energy_factor = ti.tanh(energy / 5.0)
                value = val_min + (val_max - val_min) * energy_factor
                
                # 3. HSV to RGB
                h = hue * 6.0
                i_h = ti.cast(ti.floor(h), ti.i32)
                f = h - ti.cast(i_h, ti.f32)
                p = 0.0
                q = value * (1.0 - f)
                t_val = value * f
                
                r, g, b = 0.0, 0.0, 0.0
                ih_mod = i_h % 6
                if ih_mod == 0:   r, g, b = value, t_val, p
                elif ih_mod == 1: r, g, b = q, value, p
                elif ih_mod == 2: r, g, b = p, value, t_val
                elif ih_mod == 3: r, g, b = p, q, value
                elif ih_mod == 4: r, g, b = t_val, p, value
                else:             r, g, b = value, p, q
                
                self.rgba_field[i, j] = ti.Vector([
                    ti.cast(ti.math.clamp(r * 255.0, 0.0, 255.0), ti.u8),
                    ti.cast(ti.math.clamp(g * 255.0, 0.0, 255.0), ti.u8),
                    ti.cast(ti.math.clamp(b * 255.0, 0.0, 255.0), ti.u8),
                    ti.cast(ti.math.clamp((t + ti.math.pi) / (2.0 * ti.math.pi) * 255.0, 0.0, 255.0), ti.u8)
                ])

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

                ti.atomic_add(self.sum_cos[None], ti.cos(t))
                ti.atomic_add(self.sum_sin[None], ti.sin(t))
                ti.atomic_add(self.sum_ke[None], 0.5 * w * w)

                i_dn = i + 1 if i + 1 < self.l_side else 0
                j_rt = j + 1 if j + 1 < self.l_side else 0
                
                ti.atomic_add(self.sum_pe[None], self.j[None] * (1.0 - ti.cos(t - self.theta[i_dn, j])))
                ti.atomic_add(self.sum_pe[None], self.j[None] * (1.0 - ti.cos(t - self.theta[i, j_rt])))
                ti.atomic_add(self.sum_pe[None], -self.m[None] * ti.cos(t))

        def compute_stats(self):
            if self.stats_dirty:
                self.compute_stats_kernel()
                self.stats_dirty = False

        def set_state(self, theta: np.ndarray, omega: np.ndarray):
            # Reshape input 1D arrays to 2D row-major (L, L)
            # Then transpose to match Taichi's (i, j) = (col, row) layout
            t_2d = theta.reshape(self.l_side, self.l_side).T.astype(np.float32)
            w_2d = omega.reshape(self.l_side, self.l_side).T.astype(np.float32)
            
            self.theta.from_numpy(np.ascontiguousarray(t_2d))
            self.omega.from_numpy(np.ascontiguousarray(w_2d))
            
            # Immediately compute acceleration for the new state
            self.update_acceleration()
            self.stats_dirty = True

        def get_theta(self) -> np.ndarray:
            return self.theta.to_numpy().T.flatten()

        def get_omega(self) -> np.ndarray:
            return self.omega.to_numpy().T.flatten()

        def get_state(self) -> np.ndarray:
            return np.concatenate([self.get_theta(), self.get_omega()])

        def get_rgba_pixels(self, val_min: float, val_max: float) -> np.ndarray:
            self.map_colors(val_min, val_max)
            return self.rgba_field.to_numpy().transpose(1, 0, 2)

    class TaichiSimulationEngine:
        """
        Simulation engine using Taichi backend.
        """

        def __init__(self, params: SimulationParams):
            self.params = params
            self.array = TaichiRotorArray(params.l_side, params.j_coupling, params.m_field)
            self.t = 0.0
            self.substeps = 10
            self._pbos = []
            self._pbo_idx = 0

        def set_pbos(self, pbos: list[int]):
            self._pbos = pbos

        def set_state(self, y: np.ndarray, t: float = 0.0):
            n = self.params.n_rotors
            self.array.set_state(y[:n], y[n:])
            self.t = t

        def update_params(self, j: float | None = None, m: float | None = None):
            if j is not None:
                self.array.j[None] = j
            if m is not None:
                self.array.m[None] = m
            self.array.stats_dirty = True

        def step(self, dt: float) -> bool:
            sub_dt = dt / self.substeps
            
            self.array.verlet_half_step_omega(sub_dt)
            for i in range(self.substeps):
                self.array.verlet_full_step_theta(sub_dt)
                self.array.update_acceleration()
                if i < self.substeps - 1:
                    self.array.verlet_half_step_omega(sub_dt * 2.0)
                else:
                    self.array.verlet_half_step_omega(sub_dt)
            
            self.t += dt
            self.array.stats_dirty = True
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

        def get_rgba_pixels(self, val_min: float, val_max: float) -> np.ndarray:
            return self.array.get_rgba_pixels(val_min, val_max)

        @property
        def theta(self) -> np.ndarray:
            return self.array.get_theta()

        @property
        def omega(self) -> np.ndarray:
            return self.array.get_omega()

        @property
        def y(self) -> np.ndarray:
            return self.get_state()

        def get_state(self) -> np.ndarray:
            return self.array.get_state()
else:
    class TaichiSimulationEngine:
        def __init__(self, params):
            self.params = params
            raise ImportError("Taichi is not available or failed to initialize.")

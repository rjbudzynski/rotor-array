use std::f64::consts::PI;

pub const TRIG_STEPS: usize = 8192;

pub struct TrigLut {
    sin_table: [f64; TRIG_STEPS],
}

impl TrigLut {
    pub fn new() -> Self {
        let mut sin_table = [0.0; TRIG_STEPS];
        for i in 0..TRIG_STEPS {
            let theta = (i as f64 / TRIG_STEPS as f64) * 2.0 * PI;
            sin_table[i] = theta.sin();
        }
        TrigLut { sin_table }
    }

    #[inline(always)]
    pub fn sin(&self, theta: f64) -> f64 {
        let val = (theta / (2.0 * PI)) * TRIG_STEPS as f64;
        let i = val.floor();
        let frac = val - i;
        let i_int = i as isize;
        
        let i1 = ((i_int % TRIG_STEPS as isize + TRIG_STEPS as isize) % TRIG_STEPS as isize) as usize;
        let i2 = (i1 + 1) % TRIG_STEPS;

        unsafe {
            let y1 = *self.sin_table.get_unchecked(i1);
            let y2 = *self.sin_table.get_unchecked(i2);
            y1 + frac * (y2 - y1)
        }
    }

    #[inline(always)]
    pub fn cos(&self, theta: f64) -> f64 {
        self.sin(theta + PI * 0.5)
    }
}

#[derive(Clone, Copy)]
pub struct SimulationParams {
    pub l_side: usize,
    pub j_coupling: f64,
    pub m_field: f64,
}

impl SimulationParams {
    pub fn n_rotors(&self) -> usize {
        self.l_side * self.l_side
    }
}

pub struct RotorArray {
    pub params: SimulationParams,
    pub lut: TrigLut,
    // Buffer for bond forces to avoid re-calculation and enable vectorization
    // force_h[i] is the force from i to its right neighbor
    // force_v[i] is the force from i to its bottom neighbor
    force_h: Vec<f64>,
    force_v: Vec<f64>,
}

impl RotorArray {
    pub fn new(params: SimulationParams) -> Self {
        let n = params.n_rotors();
        RotorArray { 
            params,
            lut: TrigLut::new(),
            force_h: vec![0.0; n],
            force_v: vec![0.0; n],
        }
    }

    pub fn resize(&mut self, n: usize) {
        self.force_h.resize(n, 0.0);
        self.force_v.resize(n, 0.0);
    }

    pub fn get_acceleration(&self, theta: &[f64], out_accel: &mut [f64], force_h: &mut [f64], force_v: &mut [f64]) {
        let l = self.params.l_side;
        let j = self.params.j_coupling;
        let m = self.params.m_field;
        let _n = l * l;

        // 1. Calculate all bond forces (Pass 1)
        // This loop is perfectly serial and uses the LUT.
        if j != 0.0 {
            for row in 0..l {
                let row_offset = row * l;
                let next_row_offset = ((row + 1) % l) * l;
                for col in 0..l {
                    let idx = row_offset + col;
                    let right_idx = row_offset + ((col + 1) % l);
                    let down_idx = next_row_offset + col;

                    unsafe {
                        let t_i = *theta.get_unchecked(idx);
                        let t_right = *theta.get_unchecked(right_idx);
                        let t_down = *theta.get_unchecked(down_idx);

                        *force_h.get_unchecked_mut(idx) = j * self.lut.sin(t_right - t_i);
                        *force_v.get_unchecked_mut(idx) = j * self.lut.sin(t_down - t_i);
                    }
                }
            }
        } else {
            force_h.fill(0.0);
            force_v.fill(0.0);
        }

        // 2. Aggregate forces into acceleration (Pass 2)
        // accel[i] = force_right - force_left + force_down - force_up
        // This loop is extremely SIMD friendly!
        for row in 0..l {
            let row_offset = row * l;
            let prev_row_offset = ((row + l - 1) % l) * l;
            for col in 0..l {
                let idx = row_offset + col;
                let left_idx = row_offset + ((col + l - 1) % l);
                let up_idx = prev_row_offset + col;

                unsafe {
                    let mut acc = *force_h.get_unchecked(idx) - *force_h.get_unchecked(left_idx)
                                + *force_v.get_unchecked(idx) - *force_v.get_unchecked(up_idx);
                    
                    if m != 0.0 {
                        acc -= m * self.lut.sin(*theta.get_unchecked(idx));
                    }
                    
                    *out_accel.get_unchecked_mut(idx) = acc;
                }
            }
        }
    }

    pub fn hamiltonian(&self, theta: &[f64], omega: &[f64]) -> f64 {
        let l = self.params.l_side;
        let j = self.params.j_coupling;
        let m = self.params.m_field;
        let n = self.params.n_rotors();

        let mut kinetic = 0.0;
        let mut field = 0.0;

        for i in 0..n {
            kinetic += 0.5 * omega[i] * omega[i];
            field -= m * self.lut.cos(theta[i]);
        }

        let mut potential = 0.0;
        for row in 0..l {
            let row_offset = row * l;
            let down_row_offset = ((row + 1) % l) * l;

            for col in 0..l {
                let idx = row_offset + col;
                let right_idx = row_offset + ((col + 1) % l);
                let down_idx = down_row_offset + col;

                let t = theta[idx];
                unsafe {
                    potential += j * (1.0 - self.lut.cos(*theta.get_unchecked(right_idx) - t));
                    potential += j * (1.0 - self.lut.cos(*theta.get_unchecked(down_idx) - t));
                }
            }
        }

        kinetic + potential + field
    }
}

pub struct SimulationEngine {
    pub params: SimulationParams,
    pub array: RotorArray,
    pub theta: Vec<f64>,
    pub omega: Vec<f64>,
    accel: Vec<f64>,
    force_h: Vec<f64>,
    force_v: Vec<f64>,
    accel_dirty: bool,
    pub t: f64,
    pub adaptive_substepping: bool,
    pub substeps: usize,
    pub stability_factor: f64,
}

impl SimulationEngine {
    pub fn new(params: SimulationParams) -> Self {
        let n = params.n_rotors();
        SimulationEngine {
            params,
            array: RotorArray::new(params),
            theta: vec![0.0; n],
            omega: vec![0.0; n],
            accel: vec![0.0; n],
            force_h: vec![0.0; n],
            force_v: vec![0.0; n],
            accel_dirty: true,
            t: 0.0,
            adaptive_substepping: true,
            substeps: 10,
            stability_factor: 0.006,
        }
    }

    pub fn set_state(&mut self, theta: &[f64], omega: &[f64], t: f64) {
        let n = theta.len();
        if self.theta.len() != n {
            self.theta.resize(n, 0.0);
            self.omega.resize(n, 0.0);
            self.accel.resize(n, 0.0);
            self.force_h.resize(n, 0.0);
            self.force_v.resize(n, 0.0);
            self.array.resize(n);
        }
        self.theta.copy_from_slice(theta);
        self.omega.copy_from_slice(omega);
        self.t = t;
        self.accel_dirty = true;
    }

    pub fn update_params(&mut self, j: Option<f64>, m: Option<f64>) {
        if let Some(j_val) = j {
            self.params.j_coupling = j_val;
        }
        if let Some(m_val) = m {
            self.params.m_field = m_val;
        }
        self.array.params = self.params;
        self.accel_dirty = true;
    }

    pub fn verlet_step(&mut self, dt: f64) {
        let n = self.params.n_rotors();
        let half_dt = dt * 0.5;

        if self.accel_dirty {
            self.array.get_acceleration(&self.theta, &mut self.accel, &mut self.force_h, &mut self.force_v);
            self.accel_dirty = false;
        }

        for i in 0..n {
            unsafe {
                *self.omega.get_unchecked_mut(i) += self.accel.get_unchecked(i) * half_dt;
            }
        }

        for i in 0..n {
            unsafe {
                let mut th = *self.theta.get_unchecked(i) + self.omega.get_unchecked(i) * dt;
                
                if th > PI || th < -PI {
                    th = (th + PI) % (2.0 * PI);
                    if th < 0.0 {
                        th += 2.0 * PI;
                    }
                    th -= PI;
                }
                *self.theta.get_unchecked_mut(i) = th;
            }
        }

        self.array.get_acceleration(&self.theta, &mut self.accel, &mut self.force_h, &mut self.force_v);

        for i in 0..n {
            unsafe {
                *self.omega.get_unchecked_mut(i) += self.accel.get_unchecked(i) * half_dt;
            }
        }

        self.t += dt;
    }

    pub fn step(&mut self, dt: f64) {
        if self.adaptive_substepping {
            let j = self.params.j_coupling.abs();
            let m = self.params.m_field.abs();
            let omega_max = (8.0 * j + m + 1e-9).sqrt();
            self.substeps = ((dt * omega_max) / self.stability_factor).ceil() as usize;
            if self.substeps == 0 {
                self.substeps = 1;
            }
        }

        let sub_dt = dt / self.substeps as f64;
        for _ in 0..self.substeps {
            self.verlet_step(sub_dt);
        }
    }

    pub fn get_energy(&self) -> f64 {
        self.array.hamiltonian(&self.theta, &self.omega)
    }

    pub fn get_order_parameter(&self) -> (f64, f64, f64) {
        let n = self.theta.len();
        let mut sum_cos = 0.0;
        let mut sum_sin = 0.0;
        for &th in &self.theta {
            sum_cos += self.array.lut.cos(th);
            sum_sin += self.array.lut.sin(th);
        }
        let mean_cos = sum_cos / n as f64;
        let mean_sin = sum_sin / n as f64;
        let r = (mean_cos * mean_cos + mean_sin * mean_sin).sqrt();
        (r, mean_cos, mean_sin)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_energy_conservation() {
        let params = SimulationParams {
            l_side: 4,
            j_coupling: 1.0,
            m_field: 0.5,
        };
        let mut engine = SimulationEngine::new(params);
        
        let n = params.n_rotors();
        let theta = vec![0.1; n];
        let omega = vec![0.0; n];
        engine.set_state(&theta, &omega, 0.0);
        
        let initial_energy = engine.get_energy();
        for _ in 0..100 {
            engine.step(0.01);
        }
        let final_energy = engine.get_energy();
        
        let rel_error = (final_energy - initial_energy).abs() / initial_energy.abs();
        assert!(rel_error < 1e-6, "Energy drift too high: {}", rel_error);
    }

    #[test]
    fn test_hamiltonian_reduction() {
        let params = SimulationParams {
            l_side: 1,
            j_coupling: 0.0,
            m_field: 2.0,
        };
        let engine = SimulationEngine::new(params);
        let theta = vec![PI / 3.0];
        let omega = vec![3.0];
        
        let energy = engine.array.hamiltonian(&theta, &omega);
        let expected = 0.5 * 9.0 - 2.0 * (PI / 3.0).cos();
        assert!((energy - expected).abs() < 1e-5);
    }

    #[test]
    fn test_order_parameter() {
        let params = SimulationParams {
            l_side: 2,
            j_coupling: 0.0,
            m_field: 0.0,
        };
        let mut engine = SimulationEngine::new(params);
        
        // Aligned
        engine.set_state(&vec![0.0; 4], &vec![0.0; 4], 0.0);
        let (r, _, _) = engine.get_order_parameter();
        assert!((r - 1.0).abs() < 1e-12);
        
        // Anti-aligned
        engine.set_state(&vec![0.0, PI, 0.0, PI], &vec![0.0; 4], 0.0);
        let (r, _, _) = engine.get_order_parameter();
        assert!(r < 1e-12);
    }
}
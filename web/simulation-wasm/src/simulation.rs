use std::f64::consts::PI;

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
}

impl RotorArray {
    pub fn new(params: SimulationParams) -> Self {
        RotorArray { params }
    }

    pub fn get_acceleration(&self, theta: &[f64], out_accel: &mut [f64]) {
        let l = self.params.l_side;
        let j = self.params.j_coupling;
        let m = self.params.m_field;

        for row in 0..l {
            let row_offset = row * l;
            let up_row_offset = ((row + l - 1) % l) * l;
            let down_row_offset = ((row + 1) % l) * l;

            for col in 0..l {
                let idx = row_offset + col;
                let theta_i = theta[idx];

                let left_idx = row_offset + ((col + l - 1) % l);
                let right_idx = row_offset + ((col + 1) % l);
                let up_idx = up_row_offset + col;
                let down_idx = down_row_offset + col;

                let mut force_sum = 0.0;
                force_sum += (theta[right_idx] - theta_i).sin();
                force_sum += (theta[left_idx] - theta_i).sin();
                force_sum += (theta[down_idx] - theta_i).sin();
                force_sum += (theta[up_idx] - theta_i).sin();

                out_accel[idx] = (j * force_sum) - (m * theta_i.sin());
            }
        }
    }

    pub fn hamiltonian(&self, theta: &[f64], omega: &[f64]) -> f64 {
        let l = self.params.l_side;
        let j = self.params.j_coupling;
        let m = self.params.m_field;
        let n = self.params.n_rotors();

        let mut kinetic = 0.0;
        let mut potential = 0.0;
        let mut field = 0.0;

        for i in 0..n {
            kinetic += 0.5 * omega[i] * omega[i];
            field -= m * theta[i].cos();
        }

        for row in 0..l {
            let row_offset = row * l;
            let down_row_offset = ((row + 1) % l) * l;

            for col in 0..l {
                let idx = row_offset + col;
                let right_idx = row_offset + ((col + 1) % l);
                let down_idx = down_row_offset + col;

                let t = theta[idx];
                potential += j * (1.0 - (t - theta[right_idx]).cos());
                potential += j * (1.0 - (t - theta[down_idx]).cos());
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
            accel_dirty: true,
            t: 0.0,
            adaptive_substepping: true,
            substeps: 10,
            stability_factor: 0.006,
        }
    }

    pub fn set_state(&mut self, theta: &[f64], omega: &[f64], t: f64) {
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
            self.array.get_acceleration(&self.theta, &mut self.accel);
            self.accel_dirty = false;
        }

        for i in 0..n {
            self.omega[i] += self.accel[i] * half_dt;
        }

        for i in 0..n {
            self.theta[i] += self.omega[i] * dt;
            
            // Wrap to [-pi, pi)
            let mut th = self.theta[i];
            if th > PI || th < -PI {
                th = (th + PI) % (2.0 * PI);
                if th < 0.0 {
                    th += 2.0 * PI;
                }
                th -= PI;
                self.theta[i] = th;
            }
        }

        self.array.get_acceleration(&self.theta, &mut self.accel);

        for i in 0..n {
            self.omega[i] += self.accel[i] * half_dt;
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
            sum_cos += th.cos();
            sum_sin += th.sin();
        }
        let mean_cos = sum_cos / n as f64;
        let mean_sin = sum_sin / n as f64;
        let r = (mean_cos * mean_cos + mean_sin * mean_sin).sqrt();
        (r, mean_cos, mean_sin)
    }
}

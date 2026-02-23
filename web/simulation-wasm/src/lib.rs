mod colors;
mod simulation;
mod visualizer;

use wasm_bindgen::prelude::*;
use js_sys::Float64Array;
use simulation::{SimulationEngine, SimulationParams};
use visualizer::Visualizer;

#[wasm_bindgen]
pub struct WasmSimulationEngine {
    engine: SimulationEngine,
}

#[wasm_bindgen]
impl WasmSimulationEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(l_side: usize, j_coupling: f64, m_field: f64) -> WasmSimulationEngine {
        console_error_panic_hook::set_once();
        let params = SimulationParams {
            l_side,
            j_coupling,
            m_field,
        };
        WasmSimulationEngine {
            engine: SimulationEngine::new(params),
        }
    }

    pub fn set_state(&mut self, theta: &[f64], omega: &[f64], t: f64) {
        self.engine.set_state(theta, omega, t);
    }

    pub fn update_params(&mut self, j: Option<f64>, m: Option<f64>) {
        self.engine.update_params(j, m);
    }

    pub fn step(&mut self, dt: f64) {
        self.engine.step(dt);
    }

    pub fn get_theta_ptr(&self) -> *const f64 {
        self.engine.theta.as_ptr()
    }

    pub fn get_omega_ptr(&self) -> *const f64 {
        self.engine.omega.as_ptr()
    }

    pub fn get_t(&self) -> f64 {
        self.engine.t
    }

    pub fn get_energy(&self) -> f64 {
        self.engine.get_energy()
    }

    /// Returns [r, mean_cos, mean_sin, mean_omega_sq] in a single pass over the lattice.
    pub fn get_order_parameter(&self) -> Float64Array {
        let (r, mean_cos, mean_sin, mean_omega_sq) = self.engine.get_order_parameter();
        let arr = Float64Array::new_with_length(4);
        arr.set_index(0, r);
        arr.set_index(1, mean_cos);
        arr.set_index(2, mean_sin);
        arr.set_index(3, mean_omega_sq);
        arr
    }
}

#[wasm_bindgen]
pub struct WasmVisualizer {
    visualizer: Visualizer,
}

#[wasm_bindgen]
impl WasmVisualizer {
    #[wasm_bindgen(constructor)]
    pub fn new(l_side: usize, upsample: usize) -> WasmVisualizer {
        WasmVisualizer {
            visualizer: Visualizer::new(l_side, upsample),
        }
    }

    pub fn set_dimensions(&mut self, l_side: usize, upsample: usize) {
        self.visualizer.set_dimensions(l_side, upsample);
    }

    pub fn update(&mut self, theta_ptr: *const f64, omega_ptr: *const f64, n: usize) {
        let theta = unsafe { std::slice::from_raw_parts(theta_ptr, n) };
        let omega = unsafe { std::slice::from_raw_parts(omega_ptr, n) };
        self.visualizer.update(theta, omega);
    }

    pub fn get_rgba_ptr(&self) -> *const u8 {
        self.visualizer.rgba_buffer.as_ptr() as *const u8
    }

    pub fn get_rgba_size(&self) -> usize {
        self.visualizer.rgba_buffer.len() * 4
    }
}

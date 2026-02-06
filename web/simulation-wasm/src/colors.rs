use std::f64::consts::PI;

pub const ANG_STEPS: usize = 360;
pub const ENG_STEPS: usize = 64;

pub struct ColorLut {
    data: [u8; ANG_STEPS * ENG_STEPS * 3],
}

impl ColorLut {
    pub fn new() -> Self {
        let mut data = [0u8; ANG_STEPS * ENG_STEPS * 3];
        
        for a in 0..ANG_STEPS {
            let theta = (a as f64 / ANG_STEPS as f64) * 2.0 * PI;
            let hue = theta_to_hue(theta);
            
            for e in 0..ENG_STEPS {
                let energy = (e as f64 / (ENG_STEPS - 1) as f64) * 10.0;
                let val = omega_to_value(energy);
                
                let offset = (a * ENG_STEPS + e) * 3;
                hsv_to_rgb(hue, 1.0, val, &mut data, offset);
            }
        }
        
        ColorLut { data }
    }

    pub fn get_rgb(&self, theta: f64, omega_sq: f64) -> (u8, u8, u8) {
        let mut a_norm = theta % (2.0 * PI);
        if a_norm < 0.0 {
            a_norm += 2.0 * PI;
        }
        let a_idx = ((a_norm / (2.0 * PI)) * ANG_STEPS as f64) as usize % ANG_STEPS;
        
        let e_idx = ((omega_sq / 10.0) * ENG_STEPS as f64) as usize;
        let e_idx = if e_idx >= ENG_STEPS { ENG_STEPS - 1 } else { e_idx };
        
        let offset = (a_idx * ENG_STEPS + e_idx) * 3;
        (self.data[offset], self.data[offset + 1], self.data[offset + 2])
    }
}

pub fn theta_to_hue(theta: f64) -> f64 {
    let mut h = (theta / (2.0 * PI) + 0.666) % 1.0;
    if h < 0.0 {
        h += 1.0;
    }
    h
}

pub fn omega_to_value(omega_sq: f64) -> f64 {
    let val_min = 0.4;
    let val_max = 0.8;
    let energy_factor = (omega_sq / 5.0).tanh();
    val_min + (val_max - val_min) * energy_factor
}

pub fn hsv_to_rgb(h: f64, s: f64, v: f64, out: &mut [u8], offset: usize) {
    let i = (h * 6.0).floor();
    let f = h * 6.0 - i;
    let p = v * (1.0 - s);
    let q = v * (1.0 - f * s);
    let t = v * (1.0 - (1.0 - f) * s);
    
    let (r, g, b) = match (i as i32) % 6 {
        0 => (v, t, p),
        1 => (q, v, p),
        2 => (p, v, t),
        3 => (p, q, v),
        4 => (t, p, v),
        _ => (v, p, q),
    };
    
    out[offset] = (r * 255.0) as u8;
    out[offset + 1] = (g * 255.0) as u8;
    out[offset + 2] = (b * 255.0) as u8;
}
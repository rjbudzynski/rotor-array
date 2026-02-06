use crate::colors::ColorLut;

pub struct Visualizer {
    pub l_side: usize,
    pub upsample: usize,
    pub rgba_buffer: Vec<u8>,
    mask: Vec<u8>,
    lut: ColorLut,
}

impl Visualizer {
    pub fn new(l_side: usize, upsample: usize) -> Self {
        let size = l_side * upsample;
        let mut vis = Visualizer {
            l_side,
            upsample,
            rgba_buffer: vec![0; size * size * 4],
            mask: Vec::new(),
            lut: ColorLut::new(),
        };
        vis.update_buffers();
        vis
    }

    pub fn set_dimensions(&mut self, l_side: usize, upsample: usize) {
        if self.l_side != l_side || self.upsample != upsample {
            self.l_side = l_side;
            self.upsample = upsample;
            let size = l_side * upsample;
            self.rgba_buffer.resize(size * size * 4, 0);
            self.update_buffers();
        }
    }

    fn update_buffers(&mut self) {
        let s = self.upsample;
        if s >= 4 {
            self.mask = vec![0; s * s];
            let center = (s as f64 - 1.0) / 2.0;
            let radius = 0.45 * s as f64;
            
            for y in 0..s {
                for x in 0..s {
                    let dx = x as f64 - center;
                    let dy = y as f64 - center;
                    let dist = (dx * dx + dy * dy).sqrt();
                    let mut a = 0u8;
                    if dist < radius - 0.5 {
                        a = 255;
                    } else if dist < radius + 0.5 {
                        a = (255.0 * (radius + 0.5 - dist)) as u8;
                    }
                    self.mask[y * s + x] = a;
                }
            }
        } else {
            self.mask.clear();
        }
    }

    pub fn update(&mut self, theta: &[f64], omega: &[f64]) {
        let l = self.l_side;
        let s = self.upsample;
        let total_w = l * s;
        
        // Fast clear background to black opaque
        for chunk in self.rgba_buffer.chunks_exact_mut(4) {
            chunk[0] = 0;
            chunk[1] = 0;
            chunk[2] = 0;
            chunk[3] = 255;
        }

        let has_mask = !self.mask.is_empty();

        for r in 0..l {
            let start_y = r * s;
            for c in 0..l {
                let idx = r * l + c;
                let start_x = c * s;
                
                let (r_int, g_int, b_int) = self.lut.get_rgb(theta[idx], omega[idx] * omega[idx]);
                
                if has_mask {
                    for my in 0..s {
                        let row_idx = (start_y + my) * total_w * 4;
                        let m_row_idx = my * s;
                        for mx in 0..s {
                            let alpha = self.mask[m_row_idx + mx];
                            if alpha == 0 {
                                continue;
                            }
                            
                            let p_idx = row_idx + (start_x + mx) * 4;
                            self.rgba_buffer[p_idx] = r_int;
                            self.rgba_buffer[p_idx + 1] = g_int;
                            self.rgba_buffer[p_idx + 2] = b_int;
                            self.rgba_buffer[p_idx + 3] = alpha;
                        }
                    }
                } else {
                    for my in 0..s {
                        let row_idx = (start_y + my) * total_w * 4;
                        for mx in 0..s {
                            let p_idx = row_idx + (start_x + mx) * 4;
                            self.rgba_buffer[p_idx] = r_int;
                            self.rgba_buffer[p_idx + 1] = g_int;
                            self.rgba_buffer[p_idx + 2] = b_int;
                            self.rgba_buffer[p_idx + 3] = 255;
                        }
                    }
                }
            }
        }
    }
}
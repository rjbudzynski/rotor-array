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
        
        // Use u32 pointer for 4x faster clear [0, 0, 0, 255]
        // 0xFF000000 is Big Endian for [0, 0, 0, 255] but on Little Endian WASM 
        // we likely want 0xFF000000 (A B G R). 
        let data32: &mut [u32] = unsafe {
            std::slice::from_raw_parts_mut(self.rgba_buffer.as_mut_ptr() as *mut u32, total_w * total_w)
        };
        data32.fill(0xFF000000);

        let has_mask = !self.mask.is_empty();

        for r in 0..l {
            let start_y = r * s;
            for c in 0..l {
                let idx = r * l + c;
                let start_x = c * s;
                
                let (r_int, g_int, b_int) = unsafe {
                    self.lut.get_rgb(*theta.get_unchecked(idx), *omega.get_unchecked(idx) * *omega.get_unchecked(idx))
                };
                
                if has_mask {
                    for my in 0..s {
                        let row_idx = (start_y + my) * total_w * 4;
                        let m_row_idx = my * s;
                        for mx in 0..s {
                            let alpha = unsafe { *self.mask.get_unchecked(m_row_idx + mx) };
                            if alpha == 0 {
                                continue;
                            }
                            
                            let p_idx = row_idx + (start_x + mx) * 4;
                            unsafe {
                                *self.rgba_buffer.get_unchecked_mut(p_idx) = r_int;
                                *self.rgba_buffer.get_unchecked_mut(p_idx + 1) = g_int;
                                *self.rgba_buffer.get_unchecked_mut(p_idx + 2) = b_int;
                                *self.rgba_buffer.get_unchecked_mut(p_idx + 3) = alpha;
                            }
                        }
                    }
                } else {
                    for my in 0..s {
                        let row_idx = (start_y + my) * total_w * 4;
                        for mx in 0..s {
                            let p_idx = row_idx + (start_x + mx) * 4;
                            unsafe {
                                *self.rgba_buffer.get_unchecked_mut(p_idx) = r_int;
                                *self.rgba_buffer.get_unchecked_mut(p_idx + 1) = g_int;
                                *self.rgba_buffer.get_unchecked_mut(p_idx + 2) = b_int;
                                *self.rgba_buffer.get_unchecked_mut(p_idx + 3) = 255;
                            }
                        }
                    }
                }
            }
        }
    }
}

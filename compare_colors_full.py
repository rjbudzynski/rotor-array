import numpy as np
import taichi as ti
from colors import theta_to_hue, omega_to_value, hsv_to_rgb_array

ti.init(arch=ti.cpu)

@ti.kernel
def map_colors_ref(theta: ti.f32, omega: ti.f32, val_min: ti.f32, val_max: ti.f32) -> ti.types.vector(3, ti.f32):
    # 1. Hue mapping
    hue = ((theta + 4.0 * ti.math.pi / 3.0) % (2.0 * ti.math.pi)) / (2.0 * ti.math.pi)
    
    # 2. Value mapping
    energy = omega * omega
    energy_factor = ti.tanh(energy / 2.0)
    value = val_min + (val_max - val_min) * energy_factor
    
    # 3. HSV to RGB (S=1.0)
    h = hue * 6.0
    i_h = ti.cast(ti.floor(h), ti.i32)
    f = h - ti.cast(i_h, ti.f32)
    p = 0.0
    q = value * (1.0 - f)
    t = value * f
    
    r, g, b = 0.0, 0.0, 0.0
    ih_mod = i_h % 6
    if ih_mod == 0:   r, g, b = value, t, p
    elif ih_mod == 1: r, g, b = q, value, p
    elif ih_mod == 2: r, g, b = p, value, t
    elif ih_mod == 3: r, g, b = p, q, value
    elif ih_mod == 4: r, g, b = t, p, value
    else:             r, g, b = value, p, q
    
    return ti.Vector([r, g, b])

def compare_full():
    val_min, val_max = 0.15, 1.0
    angles = np.linspace(-np.pi, np.pi, 5)
    omegas = [0.0, 1.0, 2.0]
    
    print(f"{'Angle':>8} | {'Omega':>5} | {'Numpy RGB':>15} | {'Taichi RGB':>15} | {'Match'}")
    print("-" * 65)
    
    for a in angles:
        for w in omegas:
            # Numpy
            h_np = theta_to_hue(np.array([a]))
            v_np = omega_to_value(np.array([w**2]), val_min, val_max)
            rgb_np = hsv_to_rgb_array(h_np, np.ones_like(h_np), v_np)[0]
            
            # Taichi
            rgb_ti = map_colors_ref(a, w, val_min, val_max).to_numpy()
            rgb_ti_u8 = (rgb_ti * 255.0).astype(np.uint8)
            
            match = np.allclose(rgb_np, rgb_ti_u8, atol=1)
            print(f"{a:8.2f} | {w:5.1f} | {str(rgb_np):15} | {str(rgb_ti_u8):15} | {match}")

if __name__ == "__main__":
    compare_full()

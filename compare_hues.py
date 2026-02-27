import numpy as np
import taichi as ti
from colors import theta_to_hue

ti.init(arch=ti.cpu)

@ti.kernel
def get_hue_ti(theta: ti.f32) -> ti.f32:
    # Use EXACT logic from my last change
    return ((theta + 4.0 * ti.math.pi / 3.0) % (2.0 * ti.math.pi)) / (2.0 * ti.math.pi)

def compare():
    angles = np.linspace(-np.pi, np.pi, 10)
    print(f"{'Angle':>10} | {'Numpy Hue':>10} | {'Taichi Hue':>10} | {'Diff':>10}")
    print("-" * 50)
    for a in angles:
        h_np = theta_to_hue(np.array([a]))[0]
        h_ti = get_hue_ti(a)
        print(f"{a:10.4f} | {h_np:10.4f} | {h_ti:10.4f} | {h_np - h_ti:10.4f}")

if __name__ == "__main__":
    compare()

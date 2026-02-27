import numpy as np
import taichi as ti
from taichi_simulation import TaichiSimulationEngine
from simulation import SimulationParams

def test_diag():
    l_side = 4
    params = SimulationParams(l_side=l_side, j_coupling=1.0, m_field=0.0)
    engine = TaichiSimulationEngine(params)
    
    # Set state with varied theta
    n = l_side**2
    y0 = np.zeros(2 * n, dtype=np.float32)
    # Varied theta from -pi to pi
    theta_vals = np.linspace(-np.pi, np.pi, n).astype(np.float32)
    y0[:n] = theta_vals
    engine.set_state(y0)
    
    pixels = engine.get_rgba_pixels(0.15, 1.0)
    
    print(f"Lattice size: {l_side}x{l_side}")
    for i in range(l_side):
        for j in range(l_side):
            # Remember pixels is flipped/transposed in get_rgba_pixels
            # Here we just want to see if they differ
            print(f"Pixel ({i},{j}): {pixels[i, j]}")

if __name__ == "__main__":
    test_diag()

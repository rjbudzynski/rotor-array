import numpy as np
import taichi as ti
from taichi_simulation import TaichiSimulationEngine
from simulation import SimulationParams

def test_color():
    l_side = 4
    params = SimulationParams(l_side=l_side, j_coupling=1.0, m_field=0.0)
    engine = TaichiSimulationEngine(params)
    
    # Set center to 0,0
    y0 = np.zeros(2 * l_side**2, dtype=np.float32)
    engine.set_state(y0)
    
    pixels = engine.get_rgba_pixels(0.15, 1.0)
    print(f"Taichi color for theta=0, omega=0: {pixels[2, 2]}")

if __name__ == "__main__":
    test_color()

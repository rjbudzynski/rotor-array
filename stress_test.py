import time
import numpy as np
from simulation import SimulationEngine, SimulationParams

def run_stress_test(l_side=20, duration_sim=10.0, dt=0.02):
    params = SimulationParams(l_side=l_side, j_coupling=1.0, m_field=0.5)
    engine = SimulationEngine(params)
    n = params.n_rotors
    
    # Random initial state
    y0 = np.random.uniform(-np.pi, np.pi, 2 * n)
    engine.set_state(y0)
    
    n_steps = int(duration_sim / dt)
    print(f"Running stress test: L={l_side} (N={n}), steps={n_steps}, substeps={engine.substeps}")
    
    start_time = time.perf_counter()
    for _ in range(n_steps):
        engine.step(dt)
    end_time = time.perf_counter()
    
    elapsed = end_time - start_time
    fps = n_steps / elapsed
    ms_per_frame = (elapsed / n_steps) * 1000
    
    print(f"Total time: {elapsed:.2f}s")
    print(f"Performance: {fps:.2f} FPS ({ms_per_frame:.2f} ms/frame)")
    
    # Targeting at least 60 FPS for smooth UI
    if fps >= 60:
        print("PASS: Performance is sufficient for 60 FPS UI.")
    else:
        print("WARNING: Performance is below 60 FPS.")

if __name__ == "__main__":
    run_stress_test()

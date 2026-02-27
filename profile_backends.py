import time
import numpy as np
import taichi as ti
from simulation import SimulationEngine, SimulationParams
from taichi_simulation import TaichiSimulationEngine, TAICHI_AVAILABLE

def profile_engine(engine_name, engine, l_side, steps=100):
    # Warm up
    engine.step(0.02)
    
    # Measure physics steps
    start_physics = time.perf_counter()
    for _ in range(steps):
        engine.step(0.02)
    end_physics = time.perf_counter()
    
    # Measure data transfer (to_numpy equivalent)
    start_transfer = time.perf_counter()
    for _ in range(steps):
        _ = engine.theta
        _ = engine.omega
    end_transfer = time.perf_counter()
    
    physics_ms = (end_physics - start_physics) * 1000 / steps
    transfer_ms = (end_transfer - start_transfer) * 1000 / steps
    
    print(f"{engine_name:10} | L={l_side:3} | Physics: {physics_ms:6.2f}ms | Transfer: {transfer_ms:6.2f}ms | Total: {physics_ms + transfer_ms:6.2f}ms")

def run_benchmarks():
    l_sizes = [64, 128, 256, 400]
    
    print(f"{'Backend':10} | {'Size':5} | {'Physics Latency':15} | {'Transfer Latency':15} | {'Total'}")
    print("-" * 75)
    
    for l in l_sizes:
        params = SimulationParams(l_side=l, j_coupling=1.0, m_field=0.0)
        
        # Numba
        try:
            nb_engine = SimulationEngine(params, use_numba=True)
            profile_engine("Numba", nb_engine, l)
        except Exception as e:
            print(f"Numba failed for L={l}: {e}")
            
        # Taichi
        if TAICHI_AVAILABLE:
            try:
                ti_engine = TaichiSimulationEngine(params)
                profile_engine("Taichi", ti_engine, l)
            except Exception as e:
                print(f"Taichi failed for L={l}: {e}")
        else:
            print(f"{'Taichi':10} | L={l:3} | NOT AVAILABLE")
        print("-" * 75)

if __name__ == "__main__":
    print("Profiling Rotor Array Simulation Backends...")
    run_benchmarks()

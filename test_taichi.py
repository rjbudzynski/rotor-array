import numpy as np
import pytest

from simulation import SimulationEngine, SimulationParams
from taichi_simulation import TAICHI_AVAILABLE, TaichiSimulationEngine


@pytest.mark.skipif(not TAICHI_AVAILABLE, reason="Taichi not available")
def test_taichi_vs_numpy():
    """Verify that Taichi engine matches NumPy engine for a small lattice."""
    l_side = 4
    params = SimulationParams(l_side=l_side, j_coupling=1.5, m_field=0.5)

    # Initialize both engines
    np_engine = SimulationEngine(params, use_numba=False)
    ti_engine = TaichiSimulationEngine(params)

    # Set same initial state
    n = l_side**2
    y0 = np.random.uniform(-np.pi, np.pi, 2 * n).astype(np.float32)
    np_engine.set_state(y0)
    ti_engine.set_state(y0)

    # Compare initial energy
    h_np = np_engine.get_energy()
    h_ti = ti_engine.get_energy()
    assert np.isclose(h_np, h_ti, rtol=1e-4)

    # Compare order parameter
    op_np = np_engine.get_order_parameter()
    op_ti = ti_engine.get_order_parameter()
    assert np.isclose(op_np.r, op_ti.r, rtol=1e-4)
    assert np.isclose(op_np.mean_cos, op_ti.mean_cos, rtol=1e-4)
    assert np.isclose(op_np.mean_sin, op_ti.mean_sin, rtol=1e-4)

    # Step both engines
    dt = 0.05
    np_engine.step(dt)
    ti_engine.step(dt)

    # Compare resulting states (Verlet should match closely)
    theta_np = np_engine.theta
    theta_ti = ti_engine.theta
    # Use small tolerance due to float32 vs float64
    assert np.allclose(theta_np, theta_ti, atol=1e-3)

    # Compare final energy
    assert np.isclose(np_engine.get_energy(), ti_engine.get_energy(), rtol=1e-3)

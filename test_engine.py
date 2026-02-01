import numpy as np
import pytest
from simulation import SimulationEngine, SimulationParams

def test_engine_init():
    params = SimulationParams(l_side=4, j_coupling=1.0, m_field=0.5)
    engine = SimulationEngine(params)
    assert engine.params == params
    assert len(engine.y) == 32  # 2 * 16
    assert engine.t == 0.0

def test_engine_set_state():
    params = SimulationParams(l_side=2, j_coupling=1.0, m_field=0.0)
    engine = SimulationEngine(params)
    y_new = np.random.rand(8)
    engine.set_state(y_new, t=1.5)
    assert np.allclose(engine.y, y_new)
    assert engine.t == 1.5

def test_engine_step():
    params = SimulationParams(l_side=4, j_coupling=1.0, m_field=0.0)
    engine = SimulationEngine(params)
    n = params.n_rotors
    y0 = np.zeros(2 * n)
    y0[0] = 0.1
    engine.set_state(y0)
    
    success = engine.step(0.1)
    assert success
    assert engine.t == pytest.approx(0.1)
    assert not np.allclose(engine.y, y0)

def test_engine_update_params():
    params = SimulationParams(l_side=4, j_coupling=1.0, m_field=0.0)
    engine = SimulationEngine(params)
    engine.update_params(j=2.0, m=0.3)
    assert engine.params.j_coupling == 2.0
    assert engine.params.m_field == 0.3
    assert engine.params.n_rotors == 16
    assert engine.array.params.j_coupling == 2.0

def test_engine_get_order_parameter():
    params = SimulationParams(l_side=4, j_coupling=1.0, m_field=0.0)
    engine = SimulationEngine(params)
    n = params.n_rotors
    # All at 0 => r = 1
    engine.set_state(np.zeros(2 * n))
    assert engine.get_order_parameter().r == pytest.approx(1.0)
    
    # Spread out => r < 1
    y = np.zeros(2 * n)
    y[:n] = np.linspace(0, 2*np.pi, n, endpoint=False)
    engine.set_state(y)
    assert engine.get_order_parameter().r == pytest.approx(0.0, abs=1e-10)

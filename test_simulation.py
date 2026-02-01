import numpy as np
import pytest
from simulation import RotorArray, SimulationParams, SimulationEngine

def test_energy_conservation():
    """Verify that energy is conserved when M=0."""
    # 4x4 array = 16 rotors
    l_side = 4
    params = SimulationParams(l_side=l_side, j_coupling=1.0, m_field=0.0)
    engine = SimulationEngine(params)
    
    # Initial conditions
    n = params.n_rotors
    y0 = np.zeros(2 * n)
    y0[0] = np.pi - 0.01  # theta_0,0
    engine.set_state(y0)
    engine.substeps = 50
    
    initial_energy = engine.get_energy()
    
    # Simulate for a while
    for _ in range(50):
        engine.step(0.1)
        # Energy should be conserved to within integrator tolerance
        assert np.isclose(engine.get_energy(), initial_energy, rtol=1e-5)

def test_periodic_boundary_conditions():
    """Verify that neighbors are correctly handled at boundaries (2D)."""
    # 2x2 array
    l_side = 2
    params = SimulationParams(l_side=l_side, j_coupling=1.0, m_field=0.0)
    array = RotorArray(params)
    
    # theta = [0.1, 0.2, 0.3, 0.4], omega = [0, 0, 0, 0]
    # In 2D: [[0.1, 0.2], [0.3, 0.4]]
    y = np.array([0.1, 0.2, 0.3, 0.4, 0.0, 0.0, 0.0, 0.0])
    dy = array.equations_of_motion(0, y)
    
    # theta_0,0 = 0.1
    # neighbors: theta_1,0=0.3, theta_1,0=0.3 (up/down same for L=2)
    # neighbors: theta_0,1=0.2, theta_0,1=0.2 (left/right same for L=2)
    # d_omega_0,0 = -J * (sin(0.1 - 0.3) + sin(0.1 - 0.3) + sin(0.1 - 0.2) + sin(0.1 - 0.2))
    expected_d_omega_0 = -(2 * np.sin(0.1 - 0.3) + 2 * np.sin(0.1 - 0.2))
    assert np.isclose(dy[4], expected_d_omega_0)

def test_external_field():
    """Verify that external field M affects d_omega correctly."""
    m_val = 0.5
    l_side = 3
    params = SimulationParams(l_side=l_side, j_coupling=0.0, m_field=m_val)
    array = RotorArray(params)
    
    n = params.n_rotors
    y = np.zeros(2 * n)
    y[:n] = np.random.uniform(-np.pi, np.pi, n)
    dy = array.equations_of_motion(0, y)
    
    # With J=0, d_omega should be -M * sin(theta)
    expected = -m_val * np.sin(y[:n])
    assert np.allclose(dy[n:], expected)

def test_initial_conditions_prototype():
    """Check that simulation runs for small 2D array."""
    l_side = 3
    params = SimulationParams(l_side=l_side, j_coupling=1.0, m_field=0.0)
    engine = SimulationEngine(params)
    
    n = params.n_rotors
    y0 = np.zeros(2 * n)
    y0[0] = np.pi - 0.01
    engine.set_state(y0)
    
    success = engine.step(0.5)
    assert success
    assert engine.y.shape[0] == 2 * n

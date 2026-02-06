import numpy as np

from simulation import SimulationEngine, SimulationParams


def test_verlet_energy_conservation():
    """Verify that Velocity Verlet conserves energy in 2D."""
    # 4x4 array
    params = SimulationParams(l_side=4, j_coupling=2.0, m_field=0.5)
    engine = SimulationEngine(params)
    engine.adaptive_substepping = False
    engine.substeps = 20

    # Random initial state
    np.random.seed(42)
    n = params.n_rotors
    y0 = np.random.uniform(-np.pi, np.pi, 2 * n)
    engine.set_state(y0)

    initial_energy = engine.get_energy()

    # Simulate for 100 steps of dt=0.02 (total 2.0s)
    for _ in range(100):
        engine.step(0.02)

    final_energy = engine.get_energy()

    # Symplectic integrator should conserve energy well
    assert np.isclose(final_energy, initial_energy, rtol=1e-6)


def test_verlet_field_energy_conservation():
    """Verify energy conservation with non-zero field M in 2D."""
    params = SimulationParams(l_side=3, j_coupling=1.0, m_field=1.0)
    engine = SimulationEngine(params)
    engine.adaptive_substepping = False
    engine.substeps = 50

    n = params.n_rotors
    y0 = np.zeros(2 * n)
    y0[0] = 0.5  # perturb one rotor
    engine.set_state(y0)

    initial_energy = engine.get_energy()

    for _ in range(50):
        engine.step(0.02)

    final_energy = engine.get_energy()
    assert np.isclose(final_energy, initial_energy, rtol=1e-7)

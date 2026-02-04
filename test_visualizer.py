import numpy as np

from visualizer import RotorArrayVisualizer


def test_upsample_calculation():
    """Verify adaptive upsample rate logic."""
    # Small L => High upsample
    assert RotorArrayVisualizer._calculate_upsample(10) == 64
    # Medium L
    assert RotorArrayVisualizer._calculate_upsample(20) == 32
    assert RotorArrayVisualizer._calculate_upsample(40) == 16
    # Large L => Floor
    assert RotorArrayVisualizer._calculate_upsample(100) == 16
    # Edge cases
    assert RotorArrayVisualizer._calculate_upsample(0) == 16
    assert RotorArrayVisualizer._calculate_upsample(-1) == 16


def test_visualizer_init():
    """Test visualizer initialization."""
    v = RotorArrayVisualizer(l_side=10)
    assert v.l_side == 10
    assert v.n_rotors == 100
    assert v._upsample == 64
    assert not v.show_arrows


def test_toggle_arrows():
    """Test arrow visibility toggling and threshold."""
    v = RotorArrayVisualizer(l_side=10)
    v._theta_cache = np.zeros(100)

    v.toggle_arrows(True)
    assert v.show_arrows

    v.toggle_arrows(False)
    assert not v.show_arrows

    # Test threshold
    v.set_arrow_threshold(5)
    v.toggle_arrows(True)
    # L=10 > Threshold=5, so arrows should stay off
    assert not v.show_arrows


def test_render_arrows_smoke():
    """Smoke test for arrow rendering logic (no crash)."""
    v = RotorArrayVisualizer(l_side=4)
    v.show_arrows = True
    theta = np.linspace(0, 2 * np.pi, 16)
    # Should not raise exception
    v._render_arrows(theta)

    # Test with wrong size (should clear and return)
    v._render_arrows(np.zeros(10))


def test_update_rotors_smoke():
    """Smoke test for main update logic."""
    v = RotorArrayVisualizer(l_side=4)
    theta = np.zeros(16)
    omega = np.zeros(16)
    v.update_rotors(theta, omega)
    assert v._theta_cache is not None
    assert np.allclose(v._theta_cache, theta)

import numpy as np
import pytest
from PyQt6 import QtCore

from main import MainWindow


@pytest.fixture
def app(qtbot):
    test_app = MainWindow(l_side=10)
    qtbot.addWidget(test_app)
    return test_app


def test_vortex_band_preset(app, qtbot):
    # Select Vortex Band
    with qtbot.waitSignal(app.controls.preset_combo.currentIndexChanged):
        app.controls.preset_combo.setCurrentIndex(3)

    # Defaults: wraps=1, width=1, shift=0
    l_side = app.l_side
    mid = l_side // 2
    theta = app.engine.theta.reshape(l_side, l_side)

    # Check that only the middle line is non-zero
    assert not np.allclose(theta[:, mid], 0)
    assert np.allclose(theta[:, :mid], 0)
    assert np.allclose(theta[:, mid + 1 :], 0)

    # Change width
    app.controls.p2_spin.setValue(3)
    # Trigger re-init manually if needed, but the signal should do it
    theta = app.engine.theta.reshape(l_side, l_side)
    # mid-1, mid, mid+1 should be non-zero
    assert not np.allclose(theta[:, mid - 1], 0)
    assert not np.allclose(theta[:, mid], 0)
    assert not np.allclose(theta[:, mid + 1], 0)


def test_cross_domain_preset(app, qtbot):
    with qtbot.waitSignal(app.controls.preset_combo.currentIndexChanged):
        app.controls.preset_combo.setCurrentIndex(4)

    l_side = app.l_side
    theta = app.engine.theta.reshape(l_side, l_side)

    # Check a few points in each domain
    assert theta[0, l_side // 2] == pytest.approx(np.pi / 2)  # Upper
    assert theta[l_side - 1, l_side // 2] == pytest.approx(np.pi / 2)  # Lower
    assert theta[l_side // 2, 0] == pytest.approx(-np.pi / 2)  # Left
    assert theta[l_side // 2, l_side - 1] == pytest.approx(-np.pi / 2)  # Right


def test_vortex_pair_preset(app, qtbot):
    with qtbot.waitSignal(app.controls.preset_combo.currentIndexChanged):
        app.controls.preset_combo.setCurrentIndex(5)

    assert not np.allclose(app.engine.theta, 0)
    # Total topological charge should be 0
    # (Checking the order parameter isn't a perfect test for charge but
    # it confirms it's not a uniform state)
    assert app.engine.get_order_parameter().r < 0.9


def test_skyrmion_preset(app, qtbot):
    with qtbot.waitSignal(app.controls.preset_combo.currentIndexChanged):
        app.controls.preset_combo.setCurrentIndex(6)

    l_side = app.l_side
    theta = app.engine.theta.reshape(l_side, l_side)
    # For L=10, mid is 4.5. The indices 4,5 are closest to center.
    center_val = theta[5, 5]
    assert abs(center_val) > 1.0  # Should have a significant twist at center
    assert abs(theta[0, 0]) < 0.1  # Should be near zero at corners


def test_thermalized_preset(app, qtbot):
    with qtbot.waitSignal(app.controls.preset_combo.currentIndexChanged):
        app.controls.preset_combo.setCurrentIndex(8)

    app.controls.temp_slider.setValue(100)  # T=1.0
    # Velocity should be quite high now
    assert np.var(app.engine.omega) > 0.5


def test_reset_functionality(app, qtbot):
    # Start simulation
    qtbot.mouseClick(app.controls.start_stop_button, QtCore.Qt.MouseButton.LeftButton)

    # Wait for a few steps
    qtbot.wait(200)

    # Check if energy label is updated
    assert "Energy per Rotor:" in app.info_panel.energy_label.text()
    assert "N/A" not in app.info_panel.energy_label.text()

    # Stop
    if app.timer.isActive():
        qtbot.mouseClick(app.controls.start_stop_button, QtCore.Qt.MouseButton.LeftButton)

    # Modify state
    app.engine.y[0] += 1.0

    # Reset
    qtbot.mouseClick(app.controls.reset_button, QtCore.Qt.MouseButton.LeftButton)
    qtbot.wait(200)

    assert len(app.order_history) == 0
    assert not app.timer.isActive()

    # Final cleanup
    if app.timer.isActive():
        app.timer.stop()

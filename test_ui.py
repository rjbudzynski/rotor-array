import pytest
import numpy as np
from PyQt6 import QtCore
from main import MainWindow

@pytest.fixture
def app(qtbot):
    window = MainWindow(l_side=10)
    qtbot.addWidget(window)
    return window

def test_initial_state(app):
    """Verify initial window state."""
    assert app.windowTitle() == "Rotor Array Simulation"
    assert app.l_side == 10
    assert not app.timer.isActive()

def test_toggle_simulation(app, qtbot):
    """Verify that clicking Start/Stop toggles the timer."""
    # Start
    qtbot.mouseClick(app.controls.start_stop_button, QtCore.Qt.MouseButton.LeftButton)
    assert app.timer.isActive()
    assert app.controls.start_stop_button.text() == "Stop"
    
    # Stop
    qtbot.mouseClick(app.controls.start_stop_button, QtCore.Qt.MouseButton.LeftButton)
    assert not app.timer.isActive()
    assert app.controls.start_stop_button.text() == "Start"

def test_j_slider_updates_engine(app, qtbot):
    """Verify that moving the J slider updates the engine parameters."""
    # Slider range is 0-500, value 100 means J=1.0
    # Let's set it to 200 (J=2.0)
    app.controls.j_slider.setValue(200)
    assert app.engine.params.j_coupling == 2.0
    assert app.controls.j_label.text() == "Coupling (J): 2.00"

def test_m_slider_updates_engine(app, qtbot):
    """Verify that moving the M slider updates the engine parameters."""
    app.controls.m_slider.setValue(50) # M = 0.5
    assert app.engine.params.m_field == 0.5
    assert app.controls.m_label.text() == "Field (M): 0.50"

def test_preset_change_updates_state(app, qtbot):
    """Verify that changing the preset re-initializes the simulation."""
    # Twisted
    with qtbot.waitSignal(app.controls.preset_combo.currentIndexChanged):
        app.controls.preset_combo.setCurrentIndex(1)
    
    l = app.l_side
    k = app.controls.k_spin.value()
    i_indices = np.arange(l).repeat(l).reshape(l, l).T.flatten()
    expected_theta = (2 * np.pi * k * i_indices) / l
    # Wrap expected_theta to [-pi, pi)
    expected_theta = (expected_theta + np.pi) % (2 * np.pi) - np.pi
    assert np.allclose(app.engine.theta, expected_theta)

    # Single Kick (now a Gaussian Wave Packet)
    with qtbot.waitSignal(app.controls.preset_combo.currentIndexChanged):
        app.controls.preset_combo.setCurrentIndex(7)
    app.controls.k_spin.setValue(5.5)
    
    # Peak is at the center
    mid = (l - 1) / 2.0
    yy, xx = np.indices((l, l))
    r_sq = (xx - mid)**2 + (yy - mid)**2
    expected_omega = 5.5 * np.exp(-r_sq / (2 * 2.0**2))
    assert np.allclose(app.engine.omega, expected_omega.flatten())
    assert np.allclose(app.engine.theta, 0)

    # Thermalized
    with qtbot.waitSignal(app.controls.preset_combo.currentIndexChanged):
        app.controls.preset_combo.setCurrentIndex(8)
    assert not np.allclose(app.engine.omega, 0)
    assert np.allclose(app.engine.theta, 0)

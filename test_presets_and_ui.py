import pytest
import numpy as np
from PyQt6 import QtCore
from main import MainWindow

@pytest.fixture
def app(qtbot):
    window = MainWindow(l_side=10)
    qtbot.addWidget(window)
    return window

def test_vortex_band_preset(app, qtbot):
    """Verify Vortex Band preset initialization."""
    with qtbot.waitSignal(app.controls.preset_combo.currentIndexChanged):
        app.controls.preset_combo.setCurrentIndex(3)
    
    # Defaults: wraps=1, width=1, shift=0
    l = app.l_side
    mid = l // 2
    theta = app.engine.theta.reshape(l, l)
    
    # Check that only the middle line is non-zero
    assert not np.allclose(theta[:, mid], 0)
    assert np.allclose(theta[:, :mid], 0)
    assert np.allclose(theta[:, mid+1:], 0)
    
    # Change width
    app.controls.p2_spin.setValue(3)
    theta = app.engine.theta.reshape(l, l)
    assert not np.allclose(theta[:, mid-1], 0)
    assert not np.allclose(theta[:, mid], 0)
    assert not np.allclose(theta[:, mid+1], 0)

def test_cross_domain_preset(app, qtbot):
    """Verify Cross Domain preset initialization."""
    with qtbot.waitSignal(app.controls.preset_combo.currentIndexChanged):
        app.controls.preset_combo.setCurrentIndex(4)
    
    l = app.l_side
    theta = app.engine.theta.reshape(l, l)
    
    # Check a few points in each domain
    assert theta[0, l//2] == pytest.approx(np.pi / 2) # Upper
    assert theta[l-1, l//2] == pytest.approx(np.pi / 2) # Lower
    assert theta[l//2, 0] == pytest.approx(-np.pi / 2) # Left
    assert theta[l//2, l-1] == pytest.approx(-np.pi / 2) # Right

def test_vortex_pair_preset(app, qtbot):
    """Verify Vortex Pair preset initialization."""
    with qtbot.waitSignal(app.controls.preset_combo.currentIndexChanged):
        app.controls.preset_combo.setCurrentIndex(5)
    
    assert not np.allclose(app.engine.theta, 0)
    # Total topological charge should be 0
    # (Checking the order parameter isn't a perfect test for charge but 
    # it confirms it's not a uniform state)
    assert app.engine.get_order_parameter().r < 0.9

def test_skyrmion_preset(app, qtbot):
    """Verify Skyrmion preset initialization."""
    with qtbot.waitSignal(app.controls.preset_combo.currentIndexChanged):
        app.controls.preset_combo.setCurrentIndex(6)
    
    l = app.l_side
    theta = app.engine.theta.reshape(l, l)
    # For L=10, mid is 4.5. The indices 4,5 are closest to center.
    # np.indices gives integer coordinates.
    # Skyrmion center is (4.5, 4.5)
    # theta[4,4] should be high
    assert theta[4, 4] > 2.5
    assert theta[0, 0] == pytest.approx(0, abs=1e-1)

def test_thermal_overlay(app, qtbot):
    """Verify that Initial Temp slider adds noise to the state."""
    # Temporarily set to thermalized to check if noise is added
    with qtbot.waitSignal(app.controls.preset_combo.currentIndexChanged):
        app.controls.preset_combo.setCurrentIndex(8)
    
    app.controls.temp_slider.setValue(100) # T=1.0
    # Velocity should be quite high now
    v_rms = np.sqrt(np.mean(app.engine.omega**2))
    assert v_rms > 1.0

def test_ui_info_panel_updates(app, qtbot):
    """Verify InfoPanel widgets are updated during simulation."""
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

def test_reset_functionality(app, qtbot):
    """Verify that Reset clears history and resets state."""
    qtbot.mouseClick(app.controls.start_stop_button, QtCore.Qt.MouseButton.LeftButton)
    qtbot.wait(200)
    
    assert len(app.order_history) > 0
    
    qtbot.mouseClick(app.controls.reset_button, QtCore.Qt.MouseButton.LeftButton)
    assert len(app.order_history) == 0
    assert not app.timer.isActive()
    
    # Final cleanup
    if app.timer.isActive():
        app.timer.stop()

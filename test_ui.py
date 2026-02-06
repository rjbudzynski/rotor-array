import numpy as np
import pytest
from PyQt6 import QtCore

from main import MainWindow


@pytest.fixture
def app(qtbot):
    test_app = MainWindow(l_side=10)
    qtbot.addWidget(test_app)
    return test_app


def test_start_stop(app, qtbot):
    assert not app.timer.isActive()

    # Start
    qtbot.mouseClick(app.controls.start_stop_button, QtCore.Qt.MouseButton.LeftButton)
    assert app.timer.isActive()
    assert app.controls.start_stop_button.text() == "Stop"

    # Stop
    qtbot.mouseClick(app.controls.start_stop_button, QtCore.Qt.MouseButton.LeftButton)
    assert not app.timer.isActive()
    assert app.controls.start_stop_button.text() == "Start"


def test_lattice_size_change(app, qtbot):
    new_l = 15

    # Change via spinbox
    app.controls.l_spin.setValue(new_l)
    # The signal should trigger reinit
    assert app.l_side == new_l
    assert app.engine.params.l_side == new_l
    assert len(app.engine.theta) == new_l**2


def test_preset_change(app, qtbot):
    # Default is Random (but actually first in list)
    # Change to Twisted
    with qtbot.waitSignal(app.controls.preset_combo.currentIndexChanged):
        app.controls.preset_combo.setCurrentIndex(1)

    l_side = app.l_side
    k = app.controls.k_spin.value()
    i_indices = np.arange(l_side).repeat(l_side).reshape(l_side, l_side).T.flatten()
    expected_theta = (2 * np.pi * k * i_indices) / l_side
    # Wrap expected
    expected_theta = (expected_theta + np.pi) % (2 * np.pi) - np.pi

    assert np.allclose(app.engine.theta, expected_theta)


def test_single_kick_preset(app, qtbot):
    with qtbot.waitSignal(app.controls.preset_combo.currentIndexChanged):
        app.controls.preset_combo.setCurrentIndex(8)
    app.controls.k_spin.setValue(5.5)

    # Peak is at the center
    l_side = app.l_side
    # Center of 10x10 is at 4.5, 4.5. Closest indices 4,5
    assert app.engine.omega.max() > 5.0
    assert app.engine.omega.reshape(l_side, l_side)[5, 5] > 4.0

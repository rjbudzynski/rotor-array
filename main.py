import logging
import os
import sys
from collections import deque
from typing import Optional

import numpy as np
from PyQt6 import QtCore, QtGui, QtWidgets

from presets import generate_initial_state
from simulation import NUMBA_AVAILABLE, SimulationEngine, SimulationParams
from ui import ControlPanel, InfoPanel
from visualizer import RotorArrayVisualizer

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


class MainWindow(QtWidgets.QMainWindow):
    """
    Main window for the Rotor Array simulation application.
    """

    def __init__(self, l_side: int):
        super().__init__()
        self.setWindowTitle("Rotor Array Simulation")

        # Set window icon
        icon_path = os.path.join(os.path.dirname(__file__), "icon.svg")
        if os.path.exists(icon_path):
            self.setWindowIcon(QtGui.QIcon(icon_path))

        # Simulation parameters and engine
        self.l_side = l_side
        self.j_coupling = 1.0
        self.m_field = 0.0
        self.use_numba = False

        params = SimulationParams(l_side=l_side, j_coupling=self.j_coupling, m_field=self.m_field)
        self.engine = SimulationEngine(params, use_numba=self.use_numba)

        # UI State
        self.dt = 0.02
        self.time_scale = 1.0
        self.order_history: deque[tuple[float, float]] = deque()

        # UI
        self.central_widget = QtWidgets.QWidget()
        self.setCentralWidget(self.central_widget)
        self.main_layout = QtWidgets.QHBoxLayout(self.central_widget)

        self.info_panel = InfoPanel()
        self.main_layout.addWidget(self.info_panel, stretch=1)

        self.visualizer = RotorArrayVisualizer(l_side)
        self.main_layout.addWidget(self.visualizer, stretch=4)

        self.controls = ControlPanel()
        self.controls.l_spin.setValue(self.l_side)
        self.controls.set_numba_enabled(NUMBA_AVAILABLE)
        self.controls.set_numba_checked(self.use_numba and NUMBA_AVAILABLE)
        self.main_layout.addWidget(self.controls, stretch=1)

        # Connect controls
        self.controls.l_spin.valueChanged.connect(self.reinit_simulation)

        # Connect other controls that trigger re-initialization
        reinit_triggers = [
            self.controls.preset_combo.currentIndexChanged,
            self.controls.k_spin.valueChanged,
            self.controls.p2_spin.valueChanged,
            self.controls.p3_spin.valueChanged,
            self.controls.temp_slider.valueChanged,
        ]
        for trigger in reinit_triggers:
            trigger.connect(lambda _: self.reinit_simulation(self.l_side))

        self.controls.set_j_callback(self.update_j)
        self.controls.set_m_callback(self.update_m)
        self.controls.set_time_callback(self.update_time_scale)
        self.controls.set_arrows_callback(self.toggle_arrows)
        self.controls.set_numba_callback(self.update_numba)
        self.controls.start_stop_button.toggled.connect(self.toggle_simulation)
        self.controls.reset_button.clicked.connect(self.reset_simulation)
        self.controls.help_button.clicked.connect(self.show_help)

        # Timer for simulation loop
        self.timer = QtCore.QTimer()
        self.timer.timeout.connect(self.simulation_step)

        # Initial draw
        self.y0 = self.get_initial_state()
        self.engine.set_state(self.y0)
        self.visualizer.update_rotors(self.engine.theta, self.engine.omega)
        self.update_energy_display()

        # Update mean direction visualizer
        op = self.engine.get_order_parameter()
        self.info_panel.mean_dir_visualizer.update_state(op.r, op.mean_cos, op.mean_sin)

    def showEvent(  # type: ignore[invalid-method-override] # noqa: N802
        self, event: Optional[QtGui.QShowEvent]
    ) -> None:
        super().showEvent(event)
        # Re-sync the visualizer once layout is likely stable
        self.visualizer.set_l_side(self.l_side)
        self.visualizer.update_rotors(self.engine.theta, self.engine.omega)

    def get_initial_state(self) -> np.ndarray:
        """Generate initial state based on the selected preset."""
        return generate_initial_state(
            l_side=self.l_side,
            preset_name=self.controls.preset_combo.currentText(),
            k=self.controls.k_spin.value(),
            p2=self.controls.p2_spin.value(),
            p3=self.controls.p3_spin.value(),
            temp=self.controls.temp_slider.value() / 100.0,
        )

    def reinit_simulation(self, l_side: int):
        """Re-initialize the simulation with a new lattice size or preset."""
        self.l_side = l_side
        params = SimulationParams(l_side=l_side, j_coupling=self.j_coupling, m_field=self.m_field)
        self.engine = SimulationEngine(params, use_numba=self.use_numba)

        # Reset state based on current preset
        self.y0 = self.get_initial_state()
        self.engine.set_state(self.y0)

        # Update visualizer number of rotors
        self.visualizer.set_l_side(l_side)

        # Auto-disable arrows when L > threshold
        if l_side > self.visualizer.ARROW_THRESHOLD:
            if self.controls.arrows_checkbox.isChecked():
                self.controls.set_arrows_checked(False)
                self.toggle_arrows(False)

        self.reset_simulation()

    def update_j(self, j: float):
        self.j_coupling = j
        self.engine.update_params(j=j)

    def update_m(self, m: float):
        self.m_field = m
        self.engine.update_params(m=m)

    def update_time_scale(self, scale: float):
        self.time_scale = scale

    def toggle_arrows(self, show: bool):
        """Toggle arrow overlay visibility.

        Args:
            show: True to show arrows, False to hide.
        """
        self.visualizer.toggle_arrows(show)

    def update_numba(self, enabled: bool):
        if enabled and not NUMBA_AVAILABLE:
            self.controls.set_numba_checked(False)
            return
        self.use_numba = enabled
        self.reinit_simulation(self.l_side)

    def toggle_simulation(self, started: bool):
        self.controls.set_simulation_running(started)
        if started:
            self.controls.start_stop_button.setText("Stop")
            self.timer.start(int(1000 / 60))
        else:
            self.controls.start_stop_button.setText("Start")
            self.timer.stop()

    def show_help(self):
        """Display the help dialog with content from HELP.md."""
        import os

        from ui import HelpDialog

        help_path = os.path.join(os.path.dirname(__file__), "HELP.md")
        logger.debug(f"Attempting to load help from: {help_path}")
        try:
            if not os.path.exists(help_path):
                logger.error(f"HELP.md not found at: {help_path}")
                QtWidgets.QMessageBox.critical(self, "Error", f"Help file not found:\n{help_path}")
                return
            with open(help_path, encoding="utf-8") as f:
                content = f.read()
            logger.info(f"Successfully loaded help file ({len(content)} characters)")
            dialog = HelpDialog(content, self)
            dialog.exec()
        except PermissionError:
            logger.error(f"Permission denied reading HELP.md at: {help_path}")
            QtWidgets.QMessageBox.critical(self, "Error", "Permission denied reading help file.")
        except UnicodeDecodeError as e:
            logger.error(f"Unicode decode error in HELP.md: {e}")
            QtWidgets.QMessageBox.critical(self, "Error", f"Help file has invalid encoding: {e}")
        except Exception as e:
            logger.exception(f"Unexpected error loading HELP.md: {e}")
            QtWidgets.QMessageBox.critical(self, "Error", f"Could not load HELP.md: {e}")

    def reset_simulation(self):
        # Stop simulation if it is running
        if self.controls.start_stop_button.isChecked():
            self.controls.start_stop_button.setChecked(False)

        self.engine.set_state(self.y0)
        self.order_history.clear()
        self.visualizer.update_rotors(self.engine.theta, self.engine.omega)
        self.update_energy_display()

        # Update mean direction visualizer
        op = self.engine.get_order_parameter()
        self.info_panel.mean_dir_visualizer.update_state(op.r, op.mean_cos, op.mean_sin)

        self.info_panel.update_order_plot([], [])

    def update_energy_display(self):
        energy = self.engine.get_energy()
        mean_energy = energy / self.engine.params.n_rotors
        self.info_panel.energy_label.setText(f"Energy per Rotor: {mean_energy:.4f}")

    def simulation_step(self):
        try:
            success = self.engine.step(self.dt * self.time_scale)

            if success:
                # Calculate order parameter r
                op = self.engine.get_order_parameter()
                self.order_history.append((self.engine.t, op.r))

                # Prune history to 10s window
                while self.order_history and self.order_history[0][0] < self.engine.t - 10:
                    self.order_history.popleft()

                # Update visualization
                self.visualizer.update_rotors(self.engine.theta, self.engine.omega)
                self.update_energy_display()

                # Update mean direction visualizer
                self.info_panel.mean_dir_visualizer.update_state(op.r, op.mean_cos, op.mean_sin)

                # Update order parameter plot
                times = [h[0] for h in self.order_history]
                values = [h[1] for h in self.order_history]
                self.info_panel.update_order_plot(times, values)
        except ValueError as e:
            # Simulation parameter error
            logger.error(f"Simulation error: {e}")
            self.timer.stop()
            self.controls.start_stop_button.setChecked(False)
            self.controls.start_stop_button.setText("Start")
            QtWidgets.QMessageBox.warning(
                self,
                "Simulation Error",
                f"Simulation stopped due to error:\n{e}\n\n"
                "Try reducing time scale or changing parameters.",
            )
        except Exception as e:
            # Unexpected error
            logger.exception(f"Unexpected simulation error: {e}")
            self.timer.stop()
            self.controls.start_stop_button.setChecked(False)
            self.controls.start_stop_button.setText("Start")
            QtWidgets.QMessageBox.critical(
                self,
                "Critical Error",
                f"Unexpected error in simulation:\n{e}\n\n"
                "Please check the logs and restart the application.",
            )


def main():
    QtCore.QCoreApplication.setApplicationName("RotorArraySimulation")
    QtCore.QCoreApplication.setOrganizationName("RotorArrayProject")
    QtCore.QCoreApplication.setApplicationVersion("1.0.0")

    app = QtWidgets.QApplication(sys.argv)
    app.setApplicationDisplayName("Rotor Array Simulation")

    # Set application icon
    icon_path = os.path.join(os.path.dirname(__file__), "icon.svg")
    if os.path.exists(icon_path):
        app.setWindowIcon(QtGui.QIcon(icon_path))

    l_side = 40
    window = MainWindow(l_side)
    window.resize(1000, 700)
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()

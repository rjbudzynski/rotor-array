import logging
import os
import sys
from collections import deque

import numpy as np
from PyQt6 import QtCore, QtGui, QtWidgets

from presets import generate_initial_state
from simulation import NUMBA_AVAILABLE, SimulationEngine, SimulationParams
from taichi_simulation import TAICHI_AVAILABLE, TaichiSimulationEngine
from ui import ControlPanel, InfoPanel
from visualizer import OPENGL_AVAILABLE, RotorArrayGLVisualizer, RotorArrayVisualizer
from worker import EngineSnapshot, PhysicsWorker

if OPENGL_AVAILABLE:
    from visualizer import RotorArrayGLVisualizer

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


class SquareWidget(QtWidgets.QWidget):
    """A widget that maintains a square aspect ratio."""

    def __init__(self, child: QtWidgets.QWidget, parent: QtWidgets.QWidget | None = None):
        super().__init__(parent)
        self._child = child
        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(child, alignment=QtCore.Qt.AlignmentFlag.AlignCenter)

    def set_child(self, child: QtWidgets.QWidget) -> None:
        """Update the child widget reference."""
        self._child = child

    def resizeEvent(self, a0: QtGui.QResizeEvent | None) -> None:  # noqa: N802
        """Maintain square aspect ratio by constraining the child widget."""
        super().resizeEvent(a0)
        # Check if child is still valid (not deleted during visualizer replacement)
        if self._child is not None and self._child.parent() is not None:
            size = min(self.width(), self.height())
            self._child.setFixedSize(size, size)


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
        self.use_numba = NUMBA_AVAILABLE
        self.use_taichi = TAICHI_AVAILABLE
        self.use_taichi_gpu = False
        self.use_opengl = OPENGL_AVAILABLE

        params = SimulationParams(l_side=l_side, j_coupling=self.j_coupling, m_field=self.m_field)

        # Default engine logic
        if self.use_taichi:
            self.use_numba = False
            self.engine = TaichiSimulationEngine(params)
        else:
            self.engine = SimulationEngine(params, use_numba=self.use_numba)

        self.worker = PhysicsWorker(self.engine)
        self.worker_thread = QtCore.QThread()
        self.worker.moveToThread(self.worker_thread)
        self.worker_thread.start()

        # UI State
        self.dt = 0.02
        self.time_scale = 1.0
        self.order_history: deque[tuple[float, float, float]] = deque()
        self._last_info_update_t = 0.0

        # UI
        self.central_widget = QtWidgets.QWidget()
        self.setCentralWidget(self.central_widget)
        self.main_layout = QtWidgets.QHBoxLayout(self.central_widget)

        self.info_panel = InfoPanel()
        self.main_layout.addWidget(self.info_panel, stretch=1)

        self.visualizer = self._build_visualizer()
        self.visualizer_container = SquareWidget(self.visualizer)
        self.main_layout.addWidget(self.visualizer_container, stretch=4)

        self.controls = ControlPanel()
        self.controls.l_spin.setValue(self.l_side)
        
        self.controls.set_numba_enabled(NUMBA_AVAILABLE)
        self.controls.set_numba_checked(self.use_numba)
        self.controls.set_taichi_enabled(TAICHI_AVAILABLE)
        self.controls.set_taichi_checked(self.use_taichi and TAICHI_AVAILABLE)
        self.controls.set_taichi_gpu_checked(self.use_taichi_gpu)
        self.controls.set_opengl_enabled(OPENGL_AVAILABLE)
        self.controls.set_opengl_checked(self.use_opengl and OPENGL_AVAILABLE)
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
        self.controls.set_taichi_callback(self.update_taichi)
        self.controls.set_taichi_gpu_callback(self.update_taichi_gpu)
        self.controls.set_opengl_callback(self.update_opengl)
        self.controls.start_stop_button.toggled.connect(self.toggle_simulation)
        self.controls.reset_button.clicked.connect(self.reset_simulation)
        self.controls.help_button.clicked.connect(self.show_help)

        # Timer for GUI updates
        self.timer = QtCore.QTimer()
        self.timer.timeout.connect(self.update_gui)

        # Initial draw
        self.y0 = self.get_initial_state()
        self.worker.set_state(self.y0)
        self.initial_energy = self.engine.get_energy()
        
        if self.use_taichi and self.use_opengl and isinstance(self.visualizer, RotorArrayGLVisualizer):
            pixels = self.engine.get_rgba_pixels(0.4, 0.8)
            self.visualizer.update_pixels(pixels)
        else:
            self.visualizer.update_rotors(self.engine.theta, self.engine.omega)
            
        self.update_energy_display()

        # Update mean direction visualizer
        op = self.engine.get_order_parameter()
        self.info_panel.mean_dir_visualizer.update_state(op.r, op.mean_cos, op.mean_sin)

    def showEvent(  # type: ignore[invalid-method-override] # noqa: N802
        self, event: QtGui.QShowEvent | None
    ) -> None:
        super().showEvent(event)
        # Re-sync the visualizer once layout is likely stable
        self.visualizer.set_l_side(self.l_side)
        self.visualizer.update_rotors(self.engine.theta, self.engine.omega)
        # Sync arrow state on init
        self.toggle_arrows(self.controls.arrows_checkbox.isChecked())

    def _build_visualizer(self):
        if self.use_opengl and OPENGL_AVAILABLE:
            return RotorArrayGLVisualizer(self.l_side)
        return RotorArrayVisualizer(self.l_side)

    def _replace_visualizer(self) -> None:
        # Remove old visualizer from container
        self.visualizer.setParent(None)
        self.visualizer.deleteLater()
        # Create new visualizer and add to container
        self.visualizer = self._build_visualizer()
        layout = self.visualizer_container.layout()
        if layout is not None:
            # Clear old widget from layout
            while layout.count() > 0:
                item = layout.takeAt(0)
                if item is not None:
                    widget = item.widget()
                    if widget is not None:
                        widget.setParent(None)
            layout.addWidget(self.visualizer)
            self.visualizer_container.set_child(self.visualizer)
            self.visualizer_container.resizeEvent(None)
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
        was_running = self.worker.is_running
        if was_running:
            self.toggle_simulation(False)

        self.l_side = l_side
        params = SimulationParams(l_side=l_side, j_coupling=self.j_coupling, m_field=self.m_field)
        
        if self.use_taichi and TAICHI_AVAILABLE:
            self.engine = TaichiSimulationEngine(params)
            # Link PBOs for zero-copy rendering if using OpenGL
            if self.use_opengl and isinstance(self.visualizer, RotorArrayGLVisualizer):
                self.engine.set_pbos(self.visualizer.get_pbos())
        else:
            self.engine = SimulationEngine(params, use_numba=self.use_numba)
        
        # Re-associate worker with new engine
        self.worker.engine = self.engine
        self.worker.dt = self.dt
        self.worker.time_scale = self.time_scale

        # Reset state based on current preset
        self.y0 = self.get_initial_state()
        self.worker.set_state(self.y0)
        self.initial_energy = self.engine.get_energy()

        # Update visualizer number of rotors
        self.visualizer.set_l_side(l_side)

        # Auto-disable arrows when L > threshold
        if l_side > self.visualizer.ARROW_THRESHOLD:
            if self.controls.arrows_checkbox.isChecked():
                self.controls.set_arrows_checked(False)
                self.toggle_arrows(False)

        self.reset_simulation()
        
        if was_running:
            self.toggle_simulation(True)

    def update_j(self, j: float):
        self.j_coupling = j
        self.worker.set_params(j=j)
        self.initial_energy = self.engine.get_energy()

    def update_m(self, m: float):
        self.m_field = m
        self.worker.set_params(m=m)
        self.initial_energy = self.engine.get_energy()

    def update_time_scale(self, scale: float):
        self.time_scale = scale
        self.worker.time_scale = scale

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
        self.timer.stop() # Stop GUI updates during switch
        self.use_numba = enabled
        if enabled:
            self.use_taichi = False
            self.controls.set_taichi_checked(False)
        self.reinit_simulation(self.l_side)

    def update_taichi(self, enabled: bool):
        if enabled and not TAICHI_AVAILABLE:
            self.controls.set_taichi_checked(False)
            return
        self.timer.stop() # Stop GUI updates during switch
        self.use_taichi = enabled
        if enabled:
            self.use_numba = False
            self.controls.set_numba_checked(False)
        self.reinit_simulation(self.l_side)
        
        # Link PBOs for zero-copy rendering if using OpenGL
        if enabled and self.use_opengl and isinstance(self.visualizer, RotorArrayGLVisualizer):
            self.engine.set_pbos(self.visualizer.get_pbos())

    def update_taichi_gpu(self, enabled: bool):
        from taichi_simulation import init_taichi
        self.use_taichi_gpu = enabled
        init_taichi(use_gpu=enabled)
        if self.use_taichi:
            self.reinit_simulation(self.l_side)

    def update_opengl(self, enabled: bool):
        if enabled and not OPENGL_AVAILABLE:
            self.controls.set_opengl_checked(False)
            return
        
        was_running = self.worker.is_running
        if was_running:
            self.toggle_simulation(False)
        else:
            self.timer.stop() # Ensure GUI timer is also stopped

        self.use_opengl = enabled
        self._replace_visualizer()
        
        # Link PBOs for zero-copy rendering if using Taichi
        if self.use_taichi and TAICHI_AVAILABLE and isinstance(self.visualizer, RotorArrayGLVisualizer):
            self.engine.set_pbos(self.visualizer.get_pbos())

        # Sync arrow state after visualizer switch
        self.toggle_arrows(self.controls.arrows_checkbox.isChecked())
        
        if was_running:
            self.toggle_simulation(True)
        else:
            # Refresh static frame
            self.update_gui()

    def toggle_simulation(self, started: bool):
        self.controls.set_simulation_running(started)
        if started:
            self.controls.start_stop_button.setText("Stop")
            # Start the worker loop in the background thread
            QtCore.QMetaObject.invokeMethod(
                self.worker, "run_loop", QtCore.Qt.ConnectionType.QueuedConnection
            )
            # Start the GUI update timer (60 FPS)
            self.timer.start(int(1000 / 60))
        else:
            self.controls.start_stop_button.setText("Start")
            self.worker.request_stop()
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

        self.worker.set_state(self.y0)
        self.initial_energy = self.engine.get_energy()
        self.order_history.clear()
        self._last_info_update_t = self.engine.t
        
        if self.use_taichi and self.use_opengl and isinstance(self.visualizer, RotorArrayGLVisualizer):
            pixels = self.engine.get_rgba_pixels(0.4, 0.8)
            self.visualizer.update_pixels(pixels)
        else:
            self.visualizer.update_rotors(self.engine.theta, self.engine.omega)
            
        self.update_energy_display()

        # Update mean direction visualizer
        op = self.engine.get_order_parameter()
        self.info_panel.mean_dir_visualizer.update_state(op.r, op.mean_cos, op.mean_sin)

        self.info_panel.update_order_plot([], [], [])

    def update_energy_display(self):
        energy = self.engine.get_energy()
        n = self.engine.params.n_rotors
        mean_energy = energy / n
        self.info_panel.energy_label.setText(f"Energy per Rotor: {mean_energy:.4f}")

        # Calculate drift
        if abs(self.initial_energy) > 1e-9:
            drift = (energy - self.initial_energy) / abs(self.initial_energy)
            self.info_panel.energy_drift_label.setText(f"Energy Drift: {drift:+.2e}")
        else:
            drift_abs = energy - self.initial_energy
            self.info_panel.energy_drift_label.setText(f"Energy Drift (abs): {drift_abs:+.2e}")

    def update_gui(self):
        try:
            # Throttle full snapshot (with stats) to 10 Hz
            t_now = self.engine.t
            need_full = (t_now - self._last_info_update_t >= 0.1)
            n = self.engine.params.n_rotors
            
            # Fast path for Taichi + OpenGL: fetch pre-mapped pixels
            if self.use_taichi and self.use_opengl and isinstance(self.visualizer, RotorArrayGLVisualizer):
                # We still need a snapshot for 't', but we can fetch pixels directly
                snapshot = self.worker.get_snapshot(full=need_full)
                # Fetch RGBA pixels safely via worker (aligned with web version)
                pixels = self.worker.get_pixels(0.4, 0.8)
                if pixels is not None:
                    self.visualizer.update_pixels(pixels)
            else:
                snapshot = self.worker.get_snapshot(full=need_full)
                theta = snapshot.y[:n]
                omega = snapshot.y[n:]
                self.visualizer.update_rotors(theta, omega)
                
                # Check Numba colors if possible (re-mapping manually for comparison)
                # from colors import theta_to_hue, omega_to_value, hsv_to_rgb_array
                # ...

            # Update history and info panel at 10 Hz
            if need_full:
                self._last_info_update_t = snapshot.t
                
                self.order_history.append((snapshot.t, snapshot.r, snapshot.mean_k))

                # Prune history to 10s window
                while self.order_history and self.order_history[0][0] < snapshot.t - 10:
                    self.order_history.popleft()

                # Update energy display
                mean_energy = snapshot.energy / n
                self.info_panel.energy_label.setText(f"Energy per Rotor: {mean_energy:.4f}")
                
                if abs(self.initial_energy) > 1e-9:
                    drift = (snapshot.energy - self.initial_energy) / abs(self.initial_energy)
                    self.info_panel.energy_drift_label.setText(f"Energy Drift: {drift:+.2e}")
                else:
                    drift_abs = snapshot.energy - self.initial_energy
                    self.info_panel.energy_drift_label.setText(f"Energy Drift (abs): {drift_abs:+.2e}")

                # Update mean direction visualizer
                self.info_panel.mean_dir_visualizer.update_state(snapshot.r, snapshot.mean_cos, snapshot.mean_sin)

                # Update order parameter plot
                times = [h[0] for h in self.order_history]
                r_values = [h[1] for h in self.order_history]
                k_values = [h[2] for h in self.order_history]
                self.info_panel.update_order_plot(times, r_values, k_values)
        except Exception as e:
            logger.exception(f"Unexpected GUI update error: {e}")

    def closeEvent(self, a0: QtGui.QCloseEvent | None) -> None:  # noqa: N802
        """Ensure physics thread is stopped on close."""
        self.worker.request_stop()
        self.worker_thread.quit()
        self.worker_thread.wait()
        super().closeEvent(a0)


def main():
    QtCore.QCoreApplication.setApplicationName("RotorArraySimulation")
    QtCore.QCoreApplication.setOrganizationName("RotorArrayProject")
    QtCore.QCoreApplication.setApplicationVersion("1.0.0")

    app = QtWidgets.QApplication(sys.argv)
    app.setApplicationDisplayName("Rotor Array Simulation")

    # Initialize Taichi once at start (Default to CPU mode per requirements)
    from taichi_simulation import init_taichi
    init_taichi(use_gpu=False)

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

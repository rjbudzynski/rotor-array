import sys
import os
import numpy as np
from collections import deque
from PyQt6 import QtWidgets, QtCore, QtGui
from simulation import SimulationEngine, SimulationParams
from visualizer import RotorArrayVisualizer
from ui import ControlPanel

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
        
        params = SimulationParams(l_side=l_side, j_coupling=self.j_coupling, m_field=self.m_field)
        self.engine = SimulationEngine(params)
        
        # UI State
        self.dt = 0.02
        self.time_scale = 1.0
        self.order_history: deque[tuple[float, float]] = deque()
        
        # UI
        self.central_widget = QtWidgets.QWidget()
        self.setCentralWidget(self.central_widget)
        self.layout = QtWidgets.QHBoxLayout(self.central_widget)
        
        self.visualizer = RotorArrayVisualizer(l_side)
        self.layout.addWidget(self.visualizer, stretch=4)
        
        self.controls = ControlPanel()
        self.layout.addWidget(self.controls, stretch=1)
        
        # Connect controls
        self.controls.l_spin.valueChanged.connect(self.reinit_simulation)
        self.controls.preset_combo.currentIndexChanged.connect(lambda: self.reinit_simulation(self.l_side))
        self.controls.k_spin.valueChanged.connect(lambda: self.reinit_simulation(self.l_side))
        self.controls.set_j_callback(self.update_j)
        self.controls.set_m_callback(self.update_m)
        self.controls.set_time_callback(self.update_time_scale)
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
        self.controls.mean_dir_visualizer.update_state(op.r, op.mean_cos, op.mean_sin)
        
        # Ensure correct sizing after window shows
        QtCore.QTimer.singleShot(100, self.visualizer._update_disc_size)
        # Also re-sync the range once layout is likely stable
        QtCore.QTimer.singleShot(200, lambda: self.visualizer.set_l_side(self.l_side))

    def showEvent(self, event):
        super().showEvent(event)
        # Force a resize update when window is shown
        self.visualizer._update_disc_size()

    def get_initial_state(self) -> np.ndarray:
        """Generate initial state based on the selected preset."""
        l = self.l_side
        n = l**2
        y0 = np.zeros(2 * n)
        
        preset = self.controls.preset_combo.currentText()
        
        if preset == "Random Angles":
            # theta_i from [-pi, pi)
            y0[:n] = np.random.uniform(-np.pi, np.pi, n)
        elif preset == "Twisted":
            # theta_i,j = 2*pi*k*i/L (twist along x)
            k = self.controls.k_spin.value()
            i_indices = np.arange(l).repeat(l).reshape(l, l).T.flatten()
            y0[:n] = (2 * np.pi * k * i_indices) / l
        elif preset == "Domain Wall":
            # Half at 0, half at pi (split along x)
            theta_2d = np.zeros((l, l))
            half = l // 2
            theta_2d[half:, :] = np.pi
            y0[:n] = theta_2d.flatten()
            # Tiny velocity perturbation to break unstable equilibrium
            y0[n] = 1e-6
        elif preset == "Single Kick":
            # Initial velocity kick to the first rotor (0,0)
            omega_kick = self.controls.k_spin.value()
            y0[n] = omega_kick
        elif preset == "Thermalized":
            # Random velocities (Maxwell-Boltzmann like)
            # User provides mean energy epsilon.
            # <K> = 1/2 * <omega^2> = 1/2 * sigma^2 = epsilon
            # => sigma = sqrt(2 * epsilon)
            epsilon = self.controls.k_spin.value()
            sigma = np.sqrt(max(0, 2 * epsilon))
            y0[n:] = np.random.normal(0, sigma, n)
            
        return y0

    def reinit_simulation(self, l_side: int):
        """Re-initialize the simulation with a new lattice size or preset."""
        self.l_side = l_side
        params = SimulationParams(l_side=l_side, j_coupling=self.j_coupling, m_field=self.m_field)
        self.engine = SimulationEngine(params)
        
        # Reset state based on current preset
        self.y0 = self.get_initial_state()
        self.engine.set_state(self.y0)
        
        # Update visualizer number of rotors
        self.visualizer.set_l_side(l_side)
        QtCore.QTimer.singleShot(50, self.visualizer._update_disc_size)
        
        self.reset_simulation()

    def update_j(self, j: float):
        self.j_coupling = j
        self.engine.update_params(j=j)

    def update_m(self, m: float):
        self.m_field = m
        self.engine.update_params(m=m)

    def update_time_scale(self, scale: float):
        self.time_scale = scale

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
        try:
            with open(help_path, "r", encoding="utf-8") as f:
                content = f.read()
            
            dialog = HelpDialog(content, self)
            dialog.exec()
        except Exception as e:
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
        self.controls.mean_dir_visualizer.update_state(op.r, op.mean_cos, op.mean_sin)
        
        self.controls.update_order_plot([], [])

    def update_energy_display(self):
        energy = self.engine.get_energy()
        mean_energy = energy / self.engine.params.n_rotors
        self.controls.energy_label.setText(f"Energy per Rotor: {mean_energy:.4f}")

    def simulation_step(self):
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
            self.controls.mean_dir_visualizer.update_state(op.r, op.mean_cos, op.mean_sin)
            
            # Update order parameter plot
            times = [h[0] for h in self.order_history]
            values = [h[1] for h in self.order_history]
            self.controls.update_order_plot(times, values)


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

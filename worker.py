import threading
import time
from typing import NamedTuple

import numpy as np
from PyQt6 import QtCore

from simulation import SimulationEngine, SimulationParams


class EngineSnapshot(NamedTuple):
    """A thread-safe snapshot of the simulation state."""

    y: np.ndarray
    t: float
    energy: float
    mean_k: float
    r: float
    mean_cos: float
    mean_sin: float


class PhysicsWorker(QtCore.QObject):
    """
    Worker object that runs the simulation engine in a separate thread.
    """

    # Signals
    started = QtCore.pyqtSignal()
    stopped = QtCore.pyqtSignal()
    error = QtCore.pyqtSignal(str)

    def __init__(self, engine: SimulationEngine):
        super().__init__()
        self.engine = engine
        self._lock = threading.Lock()
        self._running = False
        self._stop_requested = False

        self.dt = 0.02
        self.time_scale = 1.0

    @property
    def is_running(self) -> bool:
        with self._lock:
            return self._running

    def set_params(self, j: float | None = None, m: float | None = None) -> None:
        """Update simulation parameters safely."""
        with self._lock:
            self.engine.update_params(j=j, m=m)

    def set_state(self, y: np.ndarray, t: float = 0.0) -> None:
        """Set simulation state safely."""
        with self._lock:
            self.engine.set_state(y, t)

    def get_snapshot(self) -> EngineSnapshot:
        """Capture a consistent snapshot of the current engine state."""
        with self._lock:
            op = self.engine.get_order_parameter()
            return EngineSnapshot(
                y=self.engine.y.copy(),
                t=self.engine.t,
                energy=self.engine.get_energy(),
                mean_k=self.engine.get_mean_kinetic_energy(),
                r=op.r,
                mean_cos=op.mean_cos,
                mean_sin=op.mean_sin,
            )

    @QtCore.pyqtSlot()
    def run_loop(self) -> None:
        """Main simulation loop intended to run in a QThread."""
        self._running = True
        self._stop_requested = False
        self.started.emit()

        try:
            while not self._stop_requested:
                # Get local copies of control parameters
                # (Simple floats, don't need lock for reading if they are atomic, 
                # but we use lock for consistency with engine state)
                with self._lock:
                    dt_step = self.dt * self.time_scale
                    self.engine.step(dt_step)

                # Small sleep to prevent tight-loop starvation of other threads
                # and allow the GUI thread to catch its breath.
                time.sleep(0.0005)

        except Exception as e:
            self.error.emit(str(e))
        finally:
            self._running = False
            self._stop_requested = False
            self.stopped.emit()

    def request_stop(self) -> None:
        """Request the simulation loop to terminate."""
        self._stop_requested = True

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

    def get_snapshot(self, full: bool = True) -> EngineSnapshot:
        """Capture a consistent snapshot of the current engine state."""
        with self._lock:
            if full:
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
            else:
                # Minimal snapshot for fast visualization
                # We return NaN for stats to indicate they weren't fetched
                return EngineSnapshot(
                    y=self.engine.y.copy(),
                    t=self.engine.t,
                    energy=float('nan'),
                    mean_k=float('nan'),
                    r=float('nan'),
                    mean_cos=float('nan'),
                    mean_sin=float('nan'),
                )

    @QtCore.pyqtSlot()
    def run_loop(self) -> None:
        """Main simulation loop intended to run in a QThread."""
        self._running = True
        self._stop_requested = False
        self.started.emit()

        # Real-time sync state
        start_wall_time = time.perf_counter()
        start_sim_time = self.engine.t

        try:
            while not self._stop_requested:
                with self._lock:
                    current_sim_time = self.engine.t
                    current_wall_time = time.perf_counter()
                    
                    # Target simulation time based on wall clock
                    elapsed_wall = current_wall_time - start_wall_time
                    target_sim_time = start_sim_time + elapsed_wall * self.time_scale
                    
                    # If we are ahead of real-time, sleep
                    if current_sim_time >= target_sim_time:
                        # Sleep for a small fraction of a frame to remain responsive
                        time.sleep(0.001)
                        continue

                    # Otherwise, perform a step
                    dt_step = self.dt * self.time_scale
                    self.engine.step(dt_step)

        except Exception as e:
            self.error.emit(str(e))
        finally:
            self._running = False
            self._stop_requested = False
            self.stopped.emit()

    def request_stop(self) -> None:
        """Request the simulation loop to terminate."""
        self._stop_requested = True

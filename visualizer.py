import numpy as np
import pyqtgraph as pg
from PyQt6 import QtCore, QtGui

class RotorArrayVisualizer(pg.GraphicsLayoutWidget):
    """
    Visualizes an L x L array of rotors using a grid of discs colored by state.
    
    Hue: Rotor angle (theta)
    Luminosity: Kinetic energy (omega^2)
    """

    def __init__(self, l_side: int, parent=None):
        # Initialize attributes used in resizeEvent before calling super().__init__
        self.l_side = l_side
        self.n_rotors = l_side**2
        super().__init__(parent=parent)
        
        # Configure the plot
        self.plot = self.addPlot()
        self.plot.setAspectLocked(True)
        self.plot.showAxis('left', False)
        self.plot.showAxis('bottom', False)
        self.plot.setMenuEnabled(False)
        self.plot.setMouseEnabled(x=False, y=False)
        
        # Discs representing rotors
        self.discs = pg.ScatterPlotItem(pen=None, symbol='o', pxMode=True)
        self.plot.addItem(self.discs)
        
        self.set_l_side(l_side)

    def set_l_side(self, l_side: int):
        """Update the lattice side length and rebuild the grid."""
        self.l_side = l_side
        self.n_rotors = l_side**2
        
        # Grid positions
        x = np.arange(l_side)
        y = np.arange(l_side)
        grid_x, grid_y = np.meshgrid(x, y)
        self.pos = np.column_stack([grid_x.flatten(), grid_y.flatten()])
        
        if hasattr(self, 'discs'):
            self.discs.setData(pos=self.pos)
        
        if not hasattr(self, 'plot'):
            return

        # Stabilization: Fix the range and lock it
        # Increase padding to 1.5 to be safe
        padding = 1.5
        x_range = [-padding, l_side - 1 + padding]
        y_range = [-padding, l_side - 1 + padding]
        
        vb = self.plot.getViewBox()
        # Aspect ratio is already set in __init__, but let's be explicit
        vb.setAspectLocked(True, ratio=1.0)
        
        # Use setRange with atomic update and no padding (since we included it in ranges)
        vb.setRange(xRange=x_range, yRange=y_range, padding=0)
        
        # Disable auto-range and user interaction to keep the view fixed
        vb.enableAutoRange(axis=pg.ViewBox.XYAxes, enable=False)
        vb.setMouseEnabled(False, False)
        
        # Remove strict limits that might fight with aspect ratio locking
        vb.setLimits(xMin=None, xMax=None, yMin=None, yMax=None)
        
        self._update_disc_size()

    def _update_disc_size(self):
        """Scale disc size to fit the widget."""
        if not hasattr(self, 'l_side') or not hasattr(self, 'plot'):
            return
            
        vb = self.plot.getViewBox()
        view_rect = vb.viewRect()
        
        # Map a unit in plot coordinates to pixels
        # width_px / width_coord
        width_px = vb.width()
        height_px = vb.height()
        
        if width_px > 0 and view_rect.width() > 0:
            pixel_size_x = width_px / view_rect.width()
            pixel_size_y = height_px / view_rect.height()
            
            # Use the smaller one to ensure fitting
            pixel_size = min(pixel_size_x, pixel_size_y)
            
            # Each disc should occupy roughly 1 unit in coordinate space
            # but we want a small gap, so use 0.9
            size = max(2, pixel_size * 0.9)
            
            if hasattr(self, 'discs'):
                self.discs.setSize(size)

    def resizeEvent(self, ev):
        super().resizeEvent(ev)
        self._update_disc_size()

    def update_rotors(self, theta: np.ndarray, omega: np.ndarray):
        """
        Update the visualization with new rotor angles and velocities.
        
        Args:
            theta: Array of rotor angles (length N=L^2).
            omega: Array of rotor angular velocities (length N=L^2).
        """
        if len(theta) != self.n_rotors:
            return

        # Hue from theta: map [0, 2pi) to [0, 1]
        # Using % (2*pi) to handle wrapping correctly
        hues = (theta % (2 * np.pi)) / (2 * np.pi)
        
        # Value (Brightness) from kinetic energy omega^2
        # Zero energy -> small nonzero value (e.g. 0.2)
        # High energy -> saturates at e.g. 0.8
        v_sq = omega**2
        val_min = 0.2
        val_max = 0.8
        # Use tanh to map energy to [0, 1] softly
        energy_factor = np.tanh(v_sq / 5.0) 
        vals = val_min + (val_max - val_min) * energy_factor
        
        # Generate brushes
        brushes = []
        for i in range(self.n_rotors):
            # QColor.fromHsvF(h, s, v, a)
            # S=1.0 for full saturation
            color = QtGui.QColor.fromHsvF(hues[i], 1.0, vals[i])
            brushes.append(pg.mkBrush(color))
        
        self.discs.setBrush(brushes)
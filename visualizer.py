import numpy as np
import pyqtgraph as pg
from PyQt6 import QtCore, QtGui
from colors import theta_to_hue, omega_to_value, hsv_to_rgb_array

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
        
        # Image representing the rotor lattice
        self.img = pg.ImageItem()
        self.plot.addItem(self.img)
        
        self.set_l_side(l_side)

    def set_l_side(self, l_side: int):
        """Update the lattice side length and rebuild the grid."""
        self.l_side = l_side
        self.n_rotors = l_side**2
        
        # Center pixels at integer coordinates
        # Pixel (0, 0) covers [0, 1]x[0, 1] in local coords.
        # We want it centered at (0, 0), so translate by -0.5, -0.5
        tr = QtGui.QTransform()
        tr.translate(-0.5, -0.5)
        self.img.setTransform(tr)
        
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

    def _update_disc_size(self):
        """Scale disc size to fit the widget (No-op for ImageItem)."""
        pass

    def resizeEvent(self, ev):
        super().resizeEvent(ev)

    def update_rotors(self, theta: np.ndarray, omega: np.ndarray):
        """
        Update the visualization with new rotor angles and velocities.
        
        Args:
            theta: Array of rotor angles (length N=L^2).
            omega: Array of rotor angular velocities (length N=L^2).
        """
        if len(theta) != self.n_rotors:
            return

        # Hue from theta
        hues = theta_to_hue(theta)
        
        # Value (Brightness) from kinetic energy omega^2
        vals = omega_to_value(omega**2)
        
        # Vectorized RGB computation
        sats = np.ones_like(hues)
        rgb = hsv_to_rgb_array(hues, sats, vals)
        
        # Reshape to 2D image
        # theta is in row-major order (y then x), but ImageItem expects (x, y)
        rgb_2d = rgb.reshape(self.l_side, self.l_side, 3).transpose(1, 0, 2)
        
        self.img.setImage(rgb_2d)

    
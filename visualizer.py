import numpy as np
import pyqtgraph as pg
from PyQt6 import QtCore, QtGui
from colors import theta_to_hue, omega_to_value, hsv_to_rgb_array

class RotorArrayVisualizer(pg.GraphicsLayoutWidget):
    """
    Visualizes an L x L array of rotors using a grid of discs colored by state.
    
    Uses vectorized alpha-masking on an ImageItem to achieve high-performance
    'disc' rendering with anti-aliasing.
    """

    UPSAMPLE = 16  # Higher resolution for smoother discs

    def __init__(self, l_side: int, parent=None):
        self.l_side = l_side
        self.n_rotors = l_side**2
        super().__init__(parent=parent)
        
        self.plot = self.addPlot()
        self.plot.setAspectLocked(True)
        self.plot.showAxis('left', False)
        self.plot.showAxis('bottom', False)
        self.plot.setMenuEnabled(False)
        self.plot.setMouseEnabled(x=False, y=False)
        
        self.img = pg.ImageItem()
        # Use nearest filtering to keep disc edges sharp but consistent
        # Smoothness comes from the alpha mask resolution
        self.img.setOpts(axisOrder='col-major')
        self.plot.addItem(self.img)
        
        self.set_l_side(l_side)

    def set_l_side(self, l_side: int):
        """Update the lattice side length and rebuild the grid/mask."""
        self.l_side = l_side
        self.n_rotors = l_side**2
        
        s = self.UPSAMPLE
        # Create a single anti-aliased disc mask
        # We use float distances to get smooth edges
        y, x = np.ogrid[:s, :s]
        center = (s - 1) / 2.0
        dist = np.sqrt((x - center)**2 + (y - center)**2)
        
        radius = 0.45 * s
        # Anti-aliasing: smooth transition from 1 to 0 over ~1 pixel
        # Mask is 255 inside radius, 0 outside, with a 1-pixel ramp
        mask_f = np.clip(radius + 0.5 - dist, 0, 1)
        mask = (mask_f * 255).astype(np.uint8)
        
        # Tile it to the full lattice size. 
        # We want (X_up, Y_up) to match ImageItem's 'col-major' order.
        # np.tile(A, (rows, cols))
        self.alpha_mask = np.tile(mask, (l_side, l_side))
        
        # Pre-allocate RGBA buffer (X, Y, 4)
        total_size = l_side * s
        self.rgba_buffer = np.zeros((total_size, total_size, 4), dtype=np.uint8)
        self.rgba_buffer[..., 3] = self.alpha_mask
        
        # Center the image
        tr = QtGui.QTransform()
        # Map the [0, total_size] range of the image to [-0.5, L-0.5]
        tr.translate(-0.5, -0.5)
        tr.scale(1.0 / s, 1.0 / s)
        self.img.setTransform(tr)
        
        if not hasattr(self, 'plot'):
            return

        padding = 1.5
        x_range = [-padding, l_side - 1 + padding]
        y_range = [-padding, l_side - 1 + padding]
        
        vb = self.plot.getViewBox()
        vb.setAspectLocked(True, ratio=1.0)
        vb.setRange(xRange=x_range, yRange=y_range, padding=0)
        vb.enableAutoRange(axis=pg.ViewBox.XYAxes, enable=False)
        vb.setMouseEnabled(False, False)

    def _update_disc_size(self):
        pass

    def resizeEvent(self, ev):
        super().resizeEvent(ev)

    def update_rotors(self, theta: np.ndarray, omega: np.ndarray):
        """
        Update the visualization with new rotor angles and velocities.
        """
        if len(theta) != self.n_rotors:
            return

        hues = theta_to_hue(theta)
        vals = omega_to_value(omega**2)
        
        # Vectorized RGB computation
        sats = np.ones_like(hues)
        rgb = hsv_to_rgb_array(hues, sats, vals)
        
        # Reshape to (Y, X, 3) since theta is row-major
        rgb_2d = rgb.reshape(self.l_side, self.l_side, 3)
        
        # Upsample using repeat
        s = self.UPSAMPLE
        rgb_up = rgb_2d.repeat(s, axis=0).repeat(s, axis=1)
        
        # Transpose to (X_up, Y_up) for ImageItem col-major
        rgb_final = rgb_up.transpose(1, 0, 2)
        
        # Update buffer
        self.rgba_buffer[..., :3] = rgb_final
        self.img.setImage(self.rgba_buffer, autoLevels=False)

    
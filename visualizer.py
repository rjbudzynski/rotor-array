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

    ARROW_THRESHOLD = 60  # Auto-disable arrows when L > this value
    MIN_UPSAMPLE = 16  # Minimum pixels per disc (for large L)
    MAX_UPSAMPLE = 64  # Maximum pixels per disc (for small L)

    @staticmethod
    def _calculate_upsample(l_side: int) -> int:
        """Calculate adaptive upsample rate based on lattice size.

        Formula: max(16, min(64, int(640 / L)))
        - L=10: 64 pixels/disc (crisp large discs)
        - L=20: 32 pixels/disc
        - L=40: 16 pixels/disc (current standard)
        - L>=64: 16 pixels/disc (minimum floor)

        Args:
            l_side: Lattice side length (number of rotors per side).

        Returns:
            Upsample rate: pixels per disc in each dimension.
        """
        if l_side <= 0:
            return RotorArrayVisualizer.MIN_UPSAMPLE
        return max(
            RotorArrayVisualizer.MIN_UPSAMPLE,
            min(RotorArrayVisualizer.MAX_UPSAMPLE, int(640 / l_side)),
        )

    def __init__(self, l_side: int, parent=None):
        self.l_side = l_side
        self.n_rotors = l_side**2
        self.show_arrows = False
        self._theta_cache = None  # Cache theta for arrow rendering
        self._upsample = self._calculate_upsample(l_side)
        super().__init__(parent=parent)

        self.plot = self.addPlot()
        self.plot.setAspectLocked(True)
        self.plot.showAxis("left", False)
        self.plot.showAxis("bottom", False)
        self.plot.setMenuEnabled(False)
        self.plot.setMouseEnabled(x=False, y=False)

        # Disc color layer
        self.img = pg.ImageItem()
        self.img.setOpts(axisOrder="col-major")
        self.plot.addItem(self.img)

        # Arrow overlay layer (second ImageItem on top)
        self.arrows_img = pg.ImageItem()
        self.arrows_img.setOpts(axisOrder="col-major")
        self.plot.addItem(self.arrows_img)

        self.set_l_side(l_side)

    def toggle_arrows(self, show: bool) -> None:
        """Toggle arrow overlay visibility.

        Args:
            show: True to show arrows, False to hide.
        """
        self.show_arrows = show and (self.l_side <= self.ARROW_THRESHOLD)
        if self.show_arrows and self._theta_cache is not None:
            self._render_arrows(self._theta_cache)
        else:
            # Clear arrow layer
            self.arrows_img.clear()

    def set_arrow_threshold(self, threshold: int) -> None:
        """Set the lattice size threshold for auto-disabling arrows.

        Args:
            threshold: Maximum L value for showing arrows.
        """
        self.ARROW_THRESHOLD = threshold
        # Re-evaluate visibility if currently showing
        if self.show_arrows and self.l_side > threshold:
            self.toggle_arrows(False)

    def _render_arrows(self, theta: np.ndarray) -> None:
        """Render direction arrows overlay using QPainter.

        Args:
            theta: Array of rotor angles with shape (n_rotors,).
        """
        if not self.show_arrows or len(theta) != self.n_rotors:
            self.arrows_img.clear()
            return

        s = self._upsample
        l = self.l_side
        total_size = l * s

        # Create RGBA buffer for arrows (transparent background)
        arrows_buffer = np.zeros((total_size, total_size, 4), dtype=np.uint8)

        # Calculate arrow endpoints
        # Center of each disc in pixels
        center_offset = (s - 1) / 2.0
        # Arrow length (full radius = 0.45 * s)
        arrow_length = 0.45 * s

        # Reshape theta to 2D grid (row-major)
        theta_2d = theta.reshape(l, l)

        # Create QImage and QPainter
        # Note: QImage expects (width, height) = (X, Y)
        # Our buffer is (total_size, total_size, 4) = (X, Y, channels)
        height, width = total_size, total_size

        # Convert numpy array to QImage format
        # We need to create a properly formatted image
        image = QtGui.QImage(
            arrows_buffer.data,
            width,
            height,
            width * 4,  # bytes per line
            QtGui.QImage.Format.Format_RGBA8888,
        )

        painter = QtGui.QPainter(image)
        painter.setRenderHint(QtGui.QPainter.RenderHint.Antialiasing, False)

        # White pen for arrows, 1 pixel width
        pen = QtGui.QPen(QtGui.QColor(255, 255, 255, 220))
        pen.setWidth(1)
        painter.setPen(pen)

        # Draw arrows for each rotor
        for row in range(l):
            for col in range(l):
                idx = row * l + col
                angle = theta_2d[row, col]

                # Disc center in pixel coordinates
                center_x = col * s + center_offset
                center_y = row * s + center_offset

                # Arrow endpoint: theta=0 points down (positive Y)
                # x = sin(theta), y = cos(theta)
                end_x = center_x + arrow_length * np.sin(angle)
                end_y = center_y + arrow_length * np.cos(angle)

                painter.drawLine(int(center_x), int(center_y), int(end_x), int(end_y))

        painter.end()

        # Convert QImage back to numpy array
        # QImage data is in (X, Y) format matching our buffer
        ptr = image.bits()
        ptr.setsize(total_size * total_size * 4)
        arrows_buffer = np.frombuffer(ptr, dtype=np.uint8).reshape(total_size, total_size, 4)

        # Apply alpha mask so arrows only appear inside discs
        # arrows_buffer[..., 3] = arrows_buffer[..., 3] * (self.alpha_mask / 255)
        # Actually, let's keep arrows visible but clipped by disc boundary

        # Set the arrow image
        self.arrows_img.setImage(arrows_buffer, autoLevels=False)

        # Apply same transform as disc image
        tr = QtGui.QTransform()
        tr.translate(-0.5, -0.5)
        tr.scale(1.0 / s, 1.0 / s)
        self.arrows_img.setTransform(tr)

    def set_l_side(self, l_side: int):
        """Update the lattice side length and rebuild the grid/mask.

        Also recalculates the adaptive upsample rate based on new L value.
        """
        # Calculate new upsample rate
        new_upsample = self._calculate_upsample(l_side)

        # Check if resolution changed (need to rebuild buffers)
        resolution_changed = new_upsample != self._upsample
        self._upsample = new_upsample

        self.l_side = l_side
        self.n_rotors = l_side**2

        s = self._upsample
        # Create a single anti-aliased disc mask
        # We use float distances to get smooth edges
        y, x = np.ogrid[:s, :s]
        center = (s - 1) / 2.0
        dist = np.sqrt((x - center) ** 2 + (y - center) ** 2)

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
        if not hasattr(self, "img") or self.img is None:
            return

        tr = QtGui.QTransform()
        # Map the [0, total_size] range of the image to [-0.5, L-0.5]
        tr.translate(-0.5, -0.5)
        tr.scale(1.0 / s, 1.0 / s)
        try:
            self.img.setTransform(tr)
        except RuntimeError:
            pass

        if not hasattr(self, "plot") or self.plot is None:
            return

        padding = 1.5
        x_range = [-padding, l_side - 1 + padding]
        y_range = [-padding, l_side - 1 + padding]

        try:
            vb = self.plot.getViewBox()
            if vb is None:
                return
            vb.setAspectLocked(True, ratio=1.0)
            vb.setRange(xRange=x_range, yRange=y_range, padding=0)
            vb.enableAutoRange(axis=pg.ViewBox.XYAxes, enable=False)
            vb.setMouseEnabled(False, False)
        except RuntimeError:
            pass

        # Clear arrow cache and image when resolution changes
        if resolution_changed:
            self._theta_cache = None
            self.arrows_img.clear()

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
        s = self._upsample
        rgb_up = rgb_2d.repeat(s, axis=0).repeat(s, axis=1)

        # Transpose to (X_up, Y_up) for ImageItem col-major
        rgb_final = rgb_up.transpose(1, 0, 2)

        # Update buffer
        self.rgba_buffer[..., :3] = rgb_final
        self.img.setImage(self.rgba_buffer, autoLevels=False)

        # Cache theta and update arrows if visible
        self._theta_cache = theta.copy()
        if self.show_arrows:
            self._render_arrows(theta)

        # Update buffer
        self.rgba_buffer[..., :3] = rgb_final
        self.img.setImage(self.rgba_buffer, autoLevels=False)

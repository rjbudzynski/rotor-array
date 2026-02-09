from typing import Any, cast

import numpy as np
import pyqtgraph as pg
from PyQt6 import QtCore, QtGui, QtWidgets

from colors import hsv_to_rgb_array, omega_to_value, theta_to_hue

try:
    import pyqtgraph.opengl as gl
except Exception:  # pragma: no cover - optional dependency
    gl = None

OPENGL_AVAILABLE = gl is not None


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

    def __init__(self, l_side: int, parent: QtWidgets.QWidget | None = None):
        self.l_side = l_side
        self.n_rotors = l_side**2
        self.show_arrows = False
        self._theta_cache: np.ndarray | None = None  # Cache theta for arrow rendering
        self._upsample = self._calculate_upsample(l_side)
        super().__init__(parent=parent)

        self.plot = cast(Any, self).addPlot()
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
        l_side = self.l_side
        total_size = l_side * s

        # Create a QImage to draw into. QImage uses row-major (y, x) order.
        image = QtGui.QImage(
            total_size,
            total_size,
            QtGui.QImage.Format.Format_RGBA8888,
        )
        image.fill(QtCore.Qt.GlobalColor.transparent)

        painter = QtGui.QPainter(image)
        painter.setRenderHint(QtGui.QPainter.RenderHint.Antialiasing, True)

        # White pen for arrows, 1 pixel width
        pen = QtGui.QPen(QtGui.QColor(255, 255, 255, 220))
        pen.setWidth(1)
        painter.setPen(pen)

        # Center of each disc in pixels
        center_offset = (s - 1) / 2.0
        # Arrow length (full radius = 0.45 * s)
        arrow_length = 0.45 * s

        # Reshape theta to 2D grid (row-major)
        theta_2d = theta.reshape(l_side, l_side)

        # Draw arrows for each rotor
        for row in range(l_side):
            for col in range(l_side):
                angle = theta_2d[row, col]

                # Disc center in pixel coordinates
                center_x = col * s + center_offset
                center_y = row * s + center_offset

                end_x = center_x + arrow_length * np.sin(angle)
                end_y = center_y - arrow_length * np.cos(angle)

                painter.drawLine(QtCore.QPointF(center_x, center_y), QtCore.QPointF(end_x, end_y))

        painter.end()

        # Convert QImage to numpy array
        ptr = cast(Any, image.bits())
        ptr.setsize(total_size * total_size * 4)
        # QImage data is row-major: (Y, X, 4)
        arrows_buffer_yx = np.frombuffer(ptr, dtype=np.uint8).reshape(total_size, total_size, 4)

        # Transpose to (X, Y, 4) for pyqtgraph's col-major ImageItem
        arrows_buffer_xy = arrows_buffer_yx.transpose(1, 0, 2).copy()

        # Set the arrow image
        self.arrows_img.setImage(arrows_buffer_xy, autoLevels=False)

        # Apply same transform as disc image
        tr = QtGui.QTransform()
        tr.translate(-0.5, -0.5)
        tr.scale(1.0 / s, 1.0 / s)
        self.arrows_img.setTransform(tr)

    def set_l_side(self, l_side: int) -> None:
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
        self.alpha_mask = np.tile(mask, (l_side, l_side))

        # Pre-allocate RGBA buffer (X, Y, 4)
        total_size = l_side * s
        self.rgba_buffer = np.zeros((total_size, total_size, 4), dtype=np.uint8)
        self.rgba_buffer[..., 3] = self.alpha_mask
        self._rgb_block_view = self.rgba_buffer[..., :3].reshape(l_side, s, l_side, s, 3)

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

    def update_rotors(self, theta: np.ndarray, omega: np.ndarray) -> None:
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

        # Upsample without allocating large temporaries:
        # buffer is (X_up, Y_up, 3), so fill [x, y] blocks from rgb_2d[y, x].
        s = self._upsample
        rgb_xy = rgb_2d.transpose(1, 0, 2)
        self._rgb_block_view[:, :, :, :, :] = rgb_xy[:, None, :, None, :]
        self.img.setImage(self.rgba_buffer, autoLevels=False)

        # Cache theta and update arrows only when visible
        if self.show_arrows:
            self._theta_cache = theta.copy()
            self._render_arrows(theta)
        else:
            self._theta_cache = None


if gl is not None:

    class RotorArrayGLVisualizer(gl.GLViewWidget):
        """
        OpenGL-based visualizer using GLImageItem for higher throughput at large L.
        """

        ARROW_THRESHOLD = 60

        def __init__(self, l_side: int, parent: QtWidgets.QWidget | None = None):
            super().__init__(parent=parent)
            self.l_side = l_side
            self.n_rotors = l_side**2
            self._upsample = RotorArrayVisualizer._calculate_upsample(l_side)
            self._rgb_block_view: np.ndarray | None = None

            self.setBackgroundColor("k")
            self.setCameraPosition(distance=5.0, elevation=90, azimuth=0)

            self.img = gl.GLImageItem(np.zeros((1, 1, 4), dtype=np.uint8))
            self.addItem(self.img)
            self.set_l_side(l_side)

        def toggle_arrows(self, show: bool) -> None:
            # No arrow overlay in OpenGL path (yet).
            return

        def set_l_side(self, l_side: int) -> None:
            self.l_side = l_side
            self.n_rotors = l_side**2

            s = RotorArrayVisualizer._calculate_upsample(l_side)
            self._upsample = s
            total_size = l_side * s

            y, x = np.ogrid[:s, :s]
            center = (s - 1) / 2.0
            dist = np.sqrt((x - center) ** 2 + (y - center) ** 2)
            radius = 0.45 * s
            mask_f = np.clip(radius + 0.5 - dist, 0, 1)
            mask = (mask_f * 255).astype(np.uint8)
            alpha_mask = np.tile(mask, (l_side, l_side))

            self.rgba_buffer = np.zeros((total_size, total_size, 4), dtype=np.uint8)
            self.rgba_buffer[..., 3] = alpha_mask
            self._rgb_block_view = self.rgba_buffer[..., :3].reshape(l_side, s, l_side, s, 3)

            self.img.setData(self.rgba_buffer)
            self.img.resetTransform()
            self.img.translate(-0.5, -0.5, 0)
            self.img.scale(1.0 / s, 1.0 / s, 1.0)
            self.opts["center"] = QtGui.QVector3D(
                (l_side - 1) / 2.0, (l_side - 1) / 2.0, 0
            )
            self.setCameraPosition(distance=max(5.0, l_side / 2.0), elevation=90, azimuth=0)

        def update_rotors(self, theta: np.ndarray, omega: np.ndarray) -> None:
            if len(theta) != self.n_rotors:
                return
            if self._rgb_block_view is None:
                return

            hues = theta_to_hue(theta)
            vals = omega_to_value(omega**2)
            sats = np.ones_like(hues)
            rgb = hsv_to_rgb_array(hues, sats, vals)
            rgb_2d = rgb.reshape(self.l_side, self.l_side, 3)
            rgb_xy = rgb_2d.transpose(1, 0, 2)
            self._rgb_block_view[:, :, :, :, :] = rgb_xy[:, None, :, None, :]

            self.img.setData(self.rgba_buffer)

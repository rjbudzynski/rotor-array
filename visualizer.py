from typing import Any, cast

import numpy as np
import pyqtgraph as pg
from PyQt6 import QtCore, QtGui, QtWidgets
from PyQt6.QtOpenGL import QOpenGLShader, QOpenGLShaderProgram
from PyQt6.QtOpenGLWidgets import QOpenGLWidget

from colors import hsv_to_rgb_array, omega_to_value, theta_to_hue

try:
    from OpenGL import GL as ogl
except Exception:  # pragma: no cover - optional dependency
    ogl = None

OPENGL_AVAILABLE = ogl is not None


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

    def resizeEvent(self, ev: QtGui.QResizeEvent | None) -> None:  # noqa: N802
        """Ensure plot fills the smaller dimension, matching OpenGL behavior."""
        super().resizeEvent(ev)
        # Get the view box and lock it to a square aspect ratio that fills the widget
        # (skip if plot not yet initialized during __init__)
        if hasattr(self, "plot") and self.plot is not None:
            vb = self.plot.getViewBox()
            if vb is not None:
                vb.setAspectLocked(True, ratio=1.0)

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

        # White pen for arrows, thickness proportional to upsample (matches OpenGL ~0.015)
        pen = QtGui.QPen(QtGui.QColor(255, 255, 255, 220))
        arrow_thickness = max(1, int(0.015 * s))
        pen.setWidth(arrow_thickness)
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


if ogl is not None:
    from ctypes import c_void_p

    class RotorArrayGLVisualizer(QOpenGLWidget):
        """
        OpenGL-based visualizer using a shader to map theta/omega to color on-GPU.
        """

        ARROW_THRESHOLD = 60

        def __init__(self, l_side: int, parent: QtWidgets.QWidget | None = None):
            super().__init__(parent=parent)
            self.l_side = l_side
            self.n_rotors = l_side**2
            self._theta = np.zeros(self.n_rotors, dtype=np.float32)
            self._omega = np.zeros(self.n_rotors, dtype=np.float32)
            self._textures_dirty = True
            self._show_arrows = False

            self._program: QOpenGLShaderProgram | None = None
            self._vbo = None
            self._vbo_stride = 0
            self._state_tex = None
            self._pbos = None
            self._pbo_idx = 0
            self._tex_l_side: int | None = None

        def get_pbos(self) -> list[int]:
            """Expose the PBO IDs for external (Taichi) interop."""
            return list(self._pbos) if self._pbos is not None else []

        def get_state_tex_id(self) -> int:
            """Expose the OpenGL texture ID for external (Taichi) interop."""
            return int(self._state_tex) if self._state_tex is not None else 0

        def notify_state_updated(self) -> None:
            """Notify the visualizer that the GPU-resident state has been modified externally."""
            self._textures_dirty = False  # Skip CPU upload
            self.update()

        def toggle_arrows(self, show: bool) -> None:
            self._show_arrows = show and (self.l_side <= self.ARROW_THRESHOLD)
            self.update()

        def set_l_side(self, l_side: int) -> None:
            self.l_side = l_side
            self.n_rotors = l_side**2
            self._theta = np.zeros(self.n_rotors, dtype=np.float32)
            self._omega = np.zeros(self.n_rotors, dtype=np.float32)
            self._textures_dirty = True
            self._tex_l_side = None
            if self._show_arrows and self.l_side > self.ARROW_THRESHOLD:
                self._show_arrows = False
            self.update()

        def update_rotors(self, theta: np.ndarray, omega: np.ndarray) -> None:
            if len(theta) != self.n_rotors:
                return
            self._theta = theta.astype(np.float32, copy=False)
            self._omega = omega.astype(np.float32, copy=False)
            self._textures_dirty = True
            self.update()

        def initializeGL(self) -> None:  # noqa: N802
            ogl.glEnable(ogl.GL_BLEND)
            ogl.glBlendFunc(ogl.GL_SRC_ALPHA, ogl.GL_ONE_MINUS_SRC_ALPHA)

            vertex_src = """
            #version 120
            attribute vec2 a_pos;
            attribute vec2 a_uv;
            varying vec2 v_uv;
            void main() {
                gl_Position = vec4(a_pos, 0.0, 1.0);
                v_uv = a_uv;
            }
            """
            fragment_src = """
            #version 120
            varying vec2 v_uv;
            uniform sampler2D u_state;
            uniform float u_L;
            uniform float u_radius;
            uniform float u_edge;
            uniform float u_val_min;
            uniform float u_val_max;
            uniform float u_omega_max;
            uniform float u_show_arrows;
            uniform float u_arrow_len;
            uniform float u_arrow_thickness;

            vec3 hsv2rgb(vec3 c) {
                vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
                vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
            }

            float tanh_approx(float x) {
                float e2x = exp(2.0 * x);
                return (e2x - 1.0) / (e2x + 1.0);
            }

            void main() {
                vec2 grid = v_uv * u_L;
                vec2 cell = floor(grid);
                vec2 local = fract(grid) - vec2(0.5);
                float dist = length(local);
                float alpha = 1.0 - smoothstep(u_radius - u_edge, u_radius, dist);
                if (alpha <= 0.0) {
                    discard;
                }
                vec2 sample_uv = (cell + vec2(0.5)) / u_L;
                
                // State contains theta in R and omega in G
                vec2 state = texture2D(u_state, sample_uv).rg;
                float theta_val = state.r;
                float omega_val = state.g;

                                // Rotate by +4pi/3 so theta=0 (field direction) -> hue=2/3 (blue)
                                float hue = mod(theta_val + 4.1887902048, 6.28318530718) / 6.28318530718;
                                float energy = omega_val * omega_val;
                                float value = u_val_min + (u_val_max - u_val_min) * tanh_approx(energy / 2.0);
                                vec3 rgb = hsv2rgb(vec3(hue, 1.0, value));
                
                if (u_show_arrows > 0.5) {
                    vec2 dir = vec2(sin(theta_val), -cos(theta_val));
                    float t = dot(local, dir);
                    vec2 closest = dir * t;
                    float dist_line = length(local - closest);
                    float arrow_mask = step(0.0, t) * step(t, u_arrow_len) * step(dist_line, u_arrow_thickness);
                    if (arrow_mask > 0.0) {
                        rgb = mix(rgb, vec3(1.0), 0.9);
                    }
                }
                gl_FragColor = vec4(rgb, alpha);
            }
            """

            program = QOpenGLShaderProgram()
            program.addShaderFromSourceCode(QOpenGLShader.ShaderTypeBit.Vertex, vertex_src)
            program.addShaderFromSourceCode(QOpenGLShader.ShaderTypeBit.Fragment, fragment_src)
            program.bindAttributeLocation("a_pos", 0)
            program.bindAttributeLocation("a_uv", 1)
            program.link()
            self._program = program

            # Full-screen quad (two triangles)
            verts = np.array(
                [
                    -1.0,
                    -1.0,
                    0.0,
                    0.0,
                    1.0,
                    -1.0,
                    1.0,
                    0.0,
                    1.0,
                    1.0,
                    1.0,
                    1.0,
                    -1.0,
                    -1.0,
                    0.0,
                    0.0,
                    1.0,
                    1.0,
                    1.0,
                    1.0,
                    -1.0,
                    1.0,
                    0.0,
                    1.0,
                ],
                dtype=np.float32,
            )

            self._vbo = ogl.glGenBuffers(1)
            ogl.glBindBuffer(ogl.GL_ARRAY_BUFFER, self._vbo)
            ogl.glBufferData(ogl.GL_ARRAY_BUFFER, verts.nbytes, verts, ogl.GL_STATIC_DRAW)

            stride = 4 * 4
            self._vbo_stride = stride
            ogl.glBindBuffer(ogl.GL_ARRAY_BUFFER, 0)

            self._state_tex = ogl.glGenTextures(1)
            self._pbos = ogl.glGenBuffers(2)
            self._init_textures()

        def _init_textures(self) -> None:
            if self._state_tex is None:
                return
            ogl.glBindTexture(ogl.GL_TEXTURE_2D, self._state_tex)
            ogl.glTexParameteri(ogl.GL_TEXTURE_2D, ogl.GL_TEXTURE_MIN_FILTER, ogl.GL_NEAREST)
            ogl.glTexParameteri(ogl.GL_TEXTURE_2D, ogl.GL_TEXTURE_MAG_FILTER, ogl.GL_NEAREST)
            ogl.glTexParameteri(ogl.GL_TEXTURE_2D, ogl.GL_TEXTURE_WRAP_S, ogl.GL_CLAMP_TO_EDGE)
            ogl.glTexParameteri(ogl.GL_TEXTURE_2D, ogl.GL_TEXTURE_WRAP_T, ogl.GL_CLAMP_TO_EDGE)
            # Use dual-channel (RG) 32-bit float format
            ogl.glTexImage2D(
                ogl.GL_TEXTURE_2D,
                0,
                ogl.GL_RG32F,
                self.l_side,
                self.l_side,
                0,
                ogl.GL_RG,
                ogl.GL_FLOAT,
                None,
            )

            # Pre-allocate PBO buffers
            data_size = self.l_side * self.l_side * 2 * 4  # L * L * 2 channels * 4 bytes
            for pbo in self._pbos:
                ogl.glBindBuffer(ogl.GL_PIXEL_UNPACK_BUFFER, pbo)
                ogl.glBufferData(ogl.GL_PIXEL_UNPACK_BUFFER, data_size, None, ogl.GL_STREAM_DRAW)
            ogl.glBindBuffer(ogl.GL_PIXEL_UNPACK_BUFFER, 0)

            ogl.glPixelStorei(ogl.GL_UNPACK_ALIGNMENT, 1)
            ogl.glBindTexture(ogl.GL_TEXTURE_2D, 0)
            self._textures_dirty = True
            self._tex_l_side = self.l_side

        def resizeGL(self, w: int, h: int) -> None:  # noqa: N802
            dpr = self.devicePixelRatioF()
            w_px = int(w * dpr)
            h_px = int(h * dpr)
            size = min(w_px, h_px)
            x = (w_px - size) // 2
            y = (h_px - size) // 2
            ogl.glViewport(x, y, size, size)

        def _upload_textures(self) -> None:
            if self._state_tex is None or self._pbos is None:
                return

            # Pack theta (R) and omega (G) into a single dual-channel float32 array
            state_2d = np.empty((self.l_side, self.l_side, 2), dtype=np.float32)
            state_2d[..., 0] = self._theta.reshape(self.l_side, self.l_side)
            state_2d[..., 1] = self._omega.reshape(self.l_side, self.l_side)
            state_2d = np.ascontiguousarray(state_2d)

            # Use PBO for asynchronous upload
            pbo = self._pbos[self._pbo_idx]
            self._pbo_idx = (self._pbo_idx + 1) % 2

            ogl.glBindTexture(ogl.GL_TEXTURE_2D, self._state_tex)
            ogl.glBindBuffer(ogl.GL_PIXEL_UNPACK_BUFFER, pbo)
            
            # Orphan buffer for performance
            ogl.glBufferData(ogl.GL_PIXEL_UNPACK_BUFFER, state_2d.nbytes, None, ogl.GL_STREAM_DRAW)
            # Upload data to PBO
            ogl.glBufferData(ogl.GL_PIXEL_UNPACK_BUFFER, state_2d.nbytes, state_2d, ogl.GL_STREAM_DRAW)
            
            # Trigger asynchronous transfer from PBO to texture
            ogl.glPixelStorei(ogl.GL_UNPACK_ALIGNMENT, 1)
            ogl.glTexSubImage2D(
                ogl.GL_TEXTURE_2D,
                0,
                0,
                0,
                self.l_side,
                self.l_side,
                ogl.GL_RG,
                ogl.GL_FLOAT,
                c_void_p(0),
            )
            
            ogl.glBindBuffer(ogl.GL_PIXEL_UNPACK_BUFFER, 0)
            ogl.glBindTexture(ogl.GL_TEXTURE_2D, 0)
            self._textures_dirty = False

        def paintGL(self) -> None:  # noqa: N802
            if self._program is None or self._vbo is None:
                return
            # Ensure square viewport even if resizeGL wasn't called (HiDPI / initial draw).
            dpr = self.devicePixelRatioF()
            w_px = int(self.width() * dpr)
            h_px = int(self.height() * dpr)
            size = min(w_px, h_px)
            x = (w_px - size) // 2
            y = (h_px - size) // 2
            ogl.glViewport(x, y, size, size)
            if self._tex_l_side != self.l_side:
                self._init_textures()
            if self._textures_dirty:
                self._upload_textures()

            ogl.glClearColor(0.0, 0.0, 0.0, 1.0)
            ogl.glClear(ogl.GL_COLOR_BUFFER_BIT)

            self._program.bind()
            self._program.setUniformValue("u_L", float(self.l_side))
            self._program.setUniformValue("u_radius", 0.45)
            self._program.setUniformValue("u_edge", 0.05)
            self._program.setUniformValue("u_val_min", 0.15)
            self._program.setUniformValue("u_val_max", 1.0)
            self._program.setUniformValue("u_omega_max", 8.0)
            self._program.setUniformValue("u_show_arrows", 1.0 if self._show_arrows else 0.0)
            self._program.setUniformValue("u_arrow_len", 0.45)
            self._program.setUniformValue("u_arrow_thickness", 0.015)

            ogl.glActiveTexture(ogl.GL_TEXTURE0)
            ogl.glBindTexture(ogl.GL_TEXTURE_2D, self._state_tex)
            self._program.setUniformValue("u_state", 0)

            ogl.glBindBuffer(ogl.GL_ARRAY_BUFFER, self._vbo)

            ogl.glEnableVertexAttribArray(0)
            ogl.glVertexAttribPointer(0, 2, ogl.GL_FLOAT, False, self._vbo_stride, c_void_p(0))
            ogl.glEnableVertexAttribArray(1)
            ogl.glVertexAttribPointer(1, 2, ogl.GL_FLOAT, False, self._vbo_stride, c_void_p(8))
            ogl.glDrawArrays(ogl.GL_TRIANGLES, 0, 6)
            ogl.glDisableVertexAttribArray(0)
            ogl.glDisableVertexAttribArray(1)
            ogl.glBindBuffer(ogl.GL_ARRAY_BUFFER, 0)

            ogl.glBindTexture(ogl.GL_TEXTURE_2D, 0)
            self._program.release()

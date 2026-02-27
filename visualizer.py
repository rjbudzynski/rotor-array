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
    MIN_UPSAMPLE = 1  # 1 pixel per disc (Point Mode) for massive L
    MAX_UPSAMPLE = 64  # Maximum pixels per disc (for small L)
    POINT_MODE_PIXEL_THRESHOLD = 4.0  # Switch to solid pixels if rotor < 4px

    def _calculate_upsample(self, l_side: int) -> int:
        """Calculate adaptive upsample rate based on lattice size and widget scale."""
        if l_side <= 0:
            return 64
        
        # Calculate how many screen pixels represent one lattice unit
        size = min(self.width(), self.height())
        if size <= 0: # Widget not yet laid out
            size = 640
            
        pixel_per_rotor = size / l_side
        
        # If rotor is smaller than threshold, use 1 pixel (Point Mode)
        if pixel_per_rotor < self.POINT_MODE_PIXEL_THRESHOLD:
            return 1
            
        return max(
            4, # Minimum anti-aliased upsample
            min(self.MAX_UPSAMPLE, int(640 / l_side)),
        )

    def __init__(self, l_side: int, parent: QtWidgets.QWidget | None = None):
        self.l_side = l_side
        self.n_rotors = l_side**2
        self.show_arrows = False
        self._theta_cache: np.ndarray | None = None
        super().__init__(parent=parent)

        # Upsample depends on width/height, so we defer full init
        self._upsample = 16 

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

        # Arrow overlay layer
        self.arrows_img = pg.ImageItem()
        self.arrows_img.setOpts(axisOrder="col-major")
        self.plot.addItem(self.arrows_img)

        self.set_l_side(l_side)

    def resizeEvent(self, ev: QtGui.QResizeEvent | None) -> None:  # noqa: N802
        """Handle resize by potentially switching to Point Mode."""
        super().resizeEvent(ev)
        if hasattr(self, "plot") and self.plot is not None:
            vb = self.plot.getViewBox()
            if vb is not None:
                vb.setAspectLocked(True, ratio=1.0)
        
        # Re-check upsample on resize
        if hasattr(self, "l_side"):
            self.set_l_side(self.l_side)

    def toggle_arrows(self, show: bool) -> None:
        self.show_arrows = show and (self.l_side <= self.ARROW_THRESHOLD)
        if self.show_arrows and self._theta_cache is not None:
            self._render_arrows(self._theta_cache)
        else:
            self.arrows_img.clear()

    def _render_arrows(self, theta: np.ndarray) -> None:
        if not self.show_arrows or len(theta) != self.n_rotors:
            self.arrows_img.clear()
            return

        s = self._upsample
        l_side = self.l_side
        total_size = l_side * s

        image = QtGui.QImage(total_size, total_size, QtGui.QImage.Format.Format_RGBA8888)
        image.fill(QtCore.Qt.GlobalColor.transparent)

        painter = QtGui.QPainter(image)
        painter.setRenderHint(QtGui.QPainter.RenderHint.Antialiasing, True)

        pen = QtGui.QPen(QtGui.QColor(255, 255, 255, 220))
        arrow_thickness = max(1, int(0.015 * s))
        pen.setWidth(arrow_thickness)
        painter.setPen(pen)

        center_offset = (s - 1) / 2.0
        arrow_length = 0.45 * s
        theta_2d = theta.reshape(l_side, l_side)

        for row in range(l_side):
            for col in range(l_side):
                angle = theta_2d[row, col]
                center_x = col * s + center_offset
                center_y = row * s + center_offset
                end_x = center_x + arrow_length * np.sin(angle)
                end_y = center_y - arrow_length * np.cos(angle)
                painter.drawLine(QtCore.QPointF(center_x, center_y), QtCore.QPointF(end_x, end_y))

        painter.end()
        ptr = cast(Any, image.bits())
        ptr.setsize(total_size * total_size * 4)
        arrows_buffer_yx = np.frombuffer(ptr, dtype=np.uint8).reshape(total_size, total_size, 4)
        arrows_buffer_xy = arrows_buffer_yx.transpose(1, 0, 2).copy()
        self.arrows_img.setImage(arrows_buffer_xy, autoLevels=False)

        tr = QtGui.QTransform()
        tr.translate(-0.5, -0.5)
        tr.scale(1.0 / s, 1.0 / s)
        self.arrows_img.setTransform(tr)

    def set_l_side(self, l_side: int) -> None:
        new_upsample = self._calculate_upsample(l_side)
        resolution_changed = new_upsample != self._upsample
        self._upsample = new_upsample
        self.l_side = l_side
        self.n_rotors = l_side**2

        s = self._upsample
        if s > 1:
            y, x = np.ogrid[:s, :s]
            center = (s - 1) / 2.0
            dist = np.sqrt((x - center) ** 2 + (y - center) ** 2)
            radius = 0.45 * s
            mask_f = np.clip(radius + 0.5 - dist, 0, 1)
            mask = (mask_f * 255).astype(np.uint8)
            self.alpha_mask = np.tile(mask, (l_side, l_side))
        else:
            self.alpha_mask = np.full((l_side, l_side), 255, dtype=np.uint8)

        total_size = l_side * s
        self.rgba_buffer = np.zeros((total_size, total_size, 4), dtype=np.uint8)
        self.rgba_buffer[..., 3] = self.alpha_mask
        self._rgb_block_view = self.rgba_buffer[..., :3].reshape(l_side, s, l_side, s, 3)

        if not hasattr(self, "img") or self.img is None:
            return

        tr = QtGui.QTransform()
        tr.translate(-0.5, -0.5)
        tr.scale(1.0 / s, 1.0 / s)
        try:
            self.img.setTransform(tr)
        except RuntimeError:
            pass

        padding = 1.5
        x_range = [-padding, l_side - 1 + padding]
        y_range = [-padding, l_side - 1 + padding]

        try:
            vb = self.plot.getViewBox()
            if vb is not None:
                vb.setAspectLocked(True, ratio=1.0)
                vb.setRange(xRange=x_range, yRange=y_range, padding=0)
                vb.enableAutoRange(axis=pg.ViewBox.XYAxes, enable=False)
                vb.setMouseEnabled(False, False)
        except RuntimeError:
            pass

        if resolution_changed:
            self._theta_cache = None
            self.arrows_img.clear()

    def update_rotors(self, theta: np.ndarray, omega: np.ndarray) -> None:
        if len(theta) != self.n_rotors:
            return
        hues = theta_to_hue(theta)
        vals = omega_to_value(omega**2)
        rgb = hsv_to_rgb_array(hues, np.ones_like(hues), vals)
        rgb_2d = rgb.reshape(self.l_side, self.l_side, 3)
        s = self._upsample
        rgb_xy = rgb_2d.transpose(1, 0, 2)
        self._rgb_block_view[:, :, :, :, :] = rgb_xy[:, None, :, None, :]
        self.img.setImage(self.rgba_buffer, autoLevels=False)

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
        POINT_MODE_PIXEL_THRESHOLD = 4.0

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
            self._tex_mode: str | None = None
            self._rgba_pixels: np.ndarray | None = None
            self._using_rgba = False

        def get_pbos(self) -> list[int]:
            return list(self._pbos) if self._pbos is not None else []

        def get_state_tex_id(self) -> int:
            return int(self._state_tex) if self._state_tex is not None else 0

        def notify_state_updated(self) -> None:
            self._textures_dirty = False
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
            self._using_rgba = False
            self._theta = theta.astype(np.float32, copy=False)
            self._omega = omega.astype(np.float32, copy=False)
            self._textures_dirty = True
            self.update()

        def update_pixels(self, rgba: np.ndarray) -> None:
            self._using_rgba = True
            self._rgba_pixels = rgba
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
            uniform float u_use_rgba;
            uniform float u_solid_mode;

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
                
                float alpha = 1.0;
                if (u_solid_mode < 0.5) {
                    alpha = 1.0 - smoothstep(u_radius - u_edge, u_radius, dist);
                    if (alpha <= 0.0) {
                        discard;
                    }
                }
                
                vec2 sample_uv = (cell + vec2(0.5)) / u_L;
                vec3 rgb;
                float theta_val;

                if (u_use_rgba > 0.5) {
                    vec4 sample = texture2D(u_state, sample_uv);
                    rgb = sample.rgb;
                    // Decode theta from alpha channel: [0, 1] -> [-pi, pi]
                    theta_val = sample.a * 6.28318530718 - 3.14159265359;
                } else {
                    vec2 state = texture2D(u_state, sample_uv).rg;
                    theta_val = state.r;
                    float omega_val = state.g;
                    float hue = mod(theta_val + 4.1887902048, 6.28318530718) / 6.28318530718;
                    float energy = omega_val * omega_val;
                    float value = u_val_min + (u_val_max - u_val_min) * tanh_approx(energy / 5.0);
                    rgb = hsv2rgb(vec3(hue, 1.0, value));
                }
                
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

            verts = np.array([-1.0, -1.0, 0.0, 0.0, 1.0, -1.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0, 
                              -1.0, -1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, -1.0, 1.0, 0.0, 1.0], dtype=np.float32)
            self._vbo = ogl.glGenBuffers(1)
            ogl.glBindBuffer(ogl.GL_ARRAY_BUFFER, self._vbo)
            ogl.glBufferData(ogl.GL_ARRAY_BUFFER, verts.nbytes, verts, ogl.GL_STATIC_DRAW)
            self._vbo_stride = 16
            ogl.glBindBuffer(ogl.GL_ARRAY_BUFFER, 0)

            self._state_tex = ogl.glGenTextures(1)
            self._pbos = ogl.glGenBuffers(2)
            self._init_textures()

        def _init_textures(self) -> None:
            if self._state_tex is None:
                return
            internal_format = ogl.GL_RG32F
            gl_format = ogl.GL_RG
            gl_type = ogl.GL_FLOAT
            mode = 'physical'
            if self._using_rgba:
                internal_format = ogl.GL_RGBA8
                gl_format = ogl.GL_RGBA
                gl_type = ogl.GL_UNSIGNED_BYTE
                mode = 'visual'

            ogl.glBindTexture(ogl.GL_TEXTURE_2D, self._state_tex)
            ogl.glTexParameteri(ogl.GL_TEXTURE_2D, ogl.GL_TEXTURE_MIN_FILTER, ogl.GL_NEAREST)
            ogl.glTexParameteri(ogl.GL_TEXTURE_2D, ogl.GL_TEXTURE_MAG_FILTER, ogl.GL_NEAREST)
            ogl.glTexParameteri(ogl.GL_TEXTURE_2D, ogl.GL_TEXTURE_WRAP_S, ogl.GL_CLAMP_TO_EDGE)
            ogl.glTexParameteri(ogl.GL_TEXTURE_2D, ogl.GL_TEXTURE_WRAP_T, ogl.GL_CLAMP_TO_EDGE)
            ogl.glTexImage2D(ogl.GL_TEXTURE_2D, 0, internal_format, self.l_side, self.l_side, 0, gl_format, gl_type, None)

            data_size = self.l_side * self.l_side * 8
            for pbo in self._pbos:
                ogl.glBindBuffer(ogl.GL_PIXEL_UNPACK_BUFFER, pbo)
                ogl.glBufferData(ogl.GL_PIXEL_UNPACK_BUFFER, data_size, None, ogl.GL_STREAM_DRAW)
            ogl.glBindBuffer(ogl.GL_PIXEL_UNPACK_BUFFER, 0)
            ogl.glPixelStorei(ogl.GL_UNPACK_ALIGNMENT, 1)
            ogl.glBindTexture(ogl.GL_TEXTURE_2D, 0)
            self._textures_dirty = True
            self._tex_l_side = self.l_side
            self._tex_mode = mode

        def resizeGL(self, w: int, h: int) -> None:  # noqa: N802
            dpr = self.devicePixelRatioF()
            w_px, h_px = int(w * dpr), int(h * dpr)
            size = min(w_px, h_px)
            ogl.glViewport((w_px - size) // 2, (h_px - size) // 2, size, size)

        def _upload_textures(self) -> None:
            if self._state_tex is None or self._pbos is None:
                return
            data_to_upload = None
            gl_format, gl_type = ogl.GL_RG, ogl.GL_FLOAT
            if self._using_rgba and self._rgba_pixels is not None:
                data_to_upload = np.ascontiguousarray(self._rgba_pixels, dtype=np.uint8)
                gl_format, gl_type = ogl.GL_RGBA, ogl.GL_UNSIGNED_BYTE
            else:
                state_2d = np.empty((self.l_side, self.l_side, 2), dtype=np.float32)
                state_2d[..., 0] = self._theta.reshape(self.l_side, self.l_side)
                state_2d[..., 1] = self._omega.reshape(self.l_side, self.l_side)
                data_to_upload = np.ascontiguousarray(state_2d)

            pbo = self._pbos[self._pbo_idx]
            self._pbo_idx = (self._pbo_idx + 1) % 2
            ogl.glBindTexture(ogl.GL_TEXTURE_2D, self._state_tex)
            ogl.glBindBuffer(ogl.GL_PIXEL_UNPACK_BUFFER, pbo)
            ogl.glBufferData(ogl.GL_PIXEL_UNPACK_BUFFER, data_to_upload.nbytes, None, ogl.GL_STREAM_DRAW)
            ogl.glBufferData(ogl.GL_PIXEL_UNPACK_BUFFER, data_to_upload.nbytes, data_to_upload, ogl.GL_STREAM_DRAW)
            ogl.glPixelStorei(ogl.GL_UNPACK_ALIGNMENT, 1)
            ogl.glTexSubImage2D(ogl.GL_TEXTURE_2D, 0, 0, 0, self.l_side, self.l_side, gl_format, gl_type, c_void_p(0))
            ogl.glBindBuffer(ogl.GL_PIXEL_UNPACK_BUFFER, 0)
            ogl.glBindTexture(ogl.GL_TEXTURE_2D, 0)
            self._textures_dirty = False

        def paintGL(self) -> None:  # noqa: N802
            if self._program is None or self._vbo is None:
                return
            dpr = self.devicePixelRatioF()
            w_px, h_px = int(self.width() * dpr), int(self.height() * dpr)
            size = min(w_px, h_px)
            ogl.glViewport((w_px - size) // 2, (h_px - size) // 2, size, size)
            
            pixel_per_rotor = size / (self.l_side * dpr)
            solid_mode = pixel_per_rotor < self.POINT_MODE_PIXEL_THRESHOLD
            
            current_mode = 'visual' if self._using_rgba else 'physical'
            if self._tex_l_side != self.l_side or self._tex_mode != current_mode:
                self._init_textures()
            if self._textures_dirty:
                self._upload_textures()

            ogl.glClearColor(0.0, 0.0, 0.0, 1.0)
            ogl.glClear(ogl.GL_COLOR_BUFFER_BIT)
            self._program.bind()
            self._program.setUniformValue("u_L", float(self.l_side))
            self._program.setUniformValue("u_radius", 0.45)
            self._program.setUniformValue("u_edge", 0.05)
            self._program.setUniformValue("u_val_min", 0.4)
            self._program.setUniformValue("u_val_max", 0.8)
            self._program.setUniformValue("u_omega_max", 8.0)
            self._program.setUniformValue("u_show_arrows", 1.0 if self._show_arrows else 0.0)
            self._program.setUniformValue("u_arrow_len", 0.45)
            self._program.setUniformValue("u_arrow_thickness", 0.015)
            self._program.setUniformValue("u_use_rgba", 1.0 if self._using_rgba else 0.0)
            self._program.setUniformValue("u_solid_mode", 1.0 if solid_mode else 0.0)

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

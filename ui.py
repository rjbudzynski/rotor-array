from collections.abc import Callable
from typing import Any, cast

import numpy as np
import pyqtgraph as pg
from PyQt6 import QtCore, QtGui, QtWidgets

from colors import hsv_to_rgb_array, omega_to_value, theta_to_hue
from presets import PRESETS, get_preset_by_name


class HelpDialog(QtWidgets.QDialog):
    """
    A custom dialog to display help content with rich text/Markdown support.
    """

    def __init__(self, content: str, parent: QtWidgets.QWidget | None = None):
        super().__init__(parent=parent)
        self.setWindowTitle("Rotor Chain Simulation Help")
        self.resize(600, 500)

        layout = QtWidgets.QVBoxLayout(self)

        self.browser = QtWidgets.QTextBrowser()
        self.browser.setMarkdown(content)
        self.browser.setOpenExternalLinks(True)
        layout.addWidget(self.browser)

        buttons = QtWidgets.QDialogButtonBox(QtWidgets.QDialogButtonBox.StandardButton.Ok)
        buttons.accepted.connect(self.accept)
        layout.addWidget(buttons)


class MeanDirectionArrow(pg.GraphicsObject):
    """
    A custom graphics item that draws a white arrow with black edges.
    """

    def __init__(self):
        super().__init__()
        self.vx = 0.0
        self.vy = 0.0
        self.r = 0.0

    def set_vector(self, r: float, vx: float, vy: float) -> None:
        self.r = r
        self.vx = vx
        self.vy = vy
        self.update()

    def boundingRect(self) -> QtCore.QRectF:
        return QtCore.QRectF(-1.1, -1.1, 2.2, 2.2)

    def paint(
        self,
        painter: QtGui.QPainter,
        option: QtWidgets.QStyleOptionGraphicsItem,
        widget: QtWidgets.QWidget | None = None,
    ) -> None:
        if self.r < 0.01:
            return

        painter.setRenderHint(QtGui.QPainter.RenderHint.Antialiasing)

        # Start and end points
        start = QtCore.QPointF(0, 0)
        end = QtCore.QPointF(self.vx, self.vy)

        # Normalize direction for arrow head
        ux = self.vx / self.r
        uy = self.vy / self.r

        head_len = 0.15
        head_width = 0.08

        # Arrow head points
        p1 = end
        p2 = QtCore.QPointF(
            self.vx - head_len * ux + head_width * (-uy),
            self.vy - head_len * uy + head_width * ux,
        )
        p3 = QtCore.QPointF(
            self.vx - head_len * ux - head_width * (-uy),
            self.vy - head_len * uy - head_width * ux,
        )

        path = QtGui.QPainterPath()
        path.moveTo(start)
        path.lineTo(end)
        path.moveTo(p2)
        path.lineTo(p1)
        path.lineTo(p3)

        # Draw black outline (thick, cosmetic)
        pen_black = QtGui.QPen(
            QtCore.Qt.GlobalColor.black,
            6,
            QtCore.Qt.PenStyle.SolidLine,
            QtCore.Qt.PenCapStyle.RoundCap,
            QtCore.Qt.PenJoinStyle.RoundJoin,
        )
        pen_black.setCosmetic(True)
        painter.setPen(pen_black)
        painter.drawPath(path)

        # Draw white core (thin, cosmetic)
        pen_white = QtGui.QPen(
            QtCore.Qt.GlobalColor.white,
            2.5,
            QtCore.Qt.PenStyle.SolidLine,
            QtCore.Qt.PenCapStyle.RoundCap,
            QtCore.Qt.PenJoinStyle.RoundJoin,
        )
        pen_white.setCosmetic(True)
        painter.setPen(pen_white)
        painter.drawPath(path)


class MeanDirectionVisualizer(pg.GraphicsLayoutWidget):
    """
    Visualizes the mean direction (order parameter) as an arrow on a static color wheel.
    The disc is colored according to angle-color correspondence (HSV).
    """

    def __init__(self, parent: QtWidgets.QWidget | None = None):
        super().__init__(parent=parent)
        self.setFixedHeight(180)
        self.setBackground(None)

        self.plot = self.addPlot()
        self.plot.setAspectLocked(True)
        self.plot.showAxis("left", False)
        self.plot.showAxis("bottom", False)
        self.plot.setMenuEnabled(False)
        self.plot.setMouseEnabled(x=False, y=False)

        # Static Color Wheel (Disc)
        size = 256
        # indexing='ij' means first axis is X, second is Y
        x = np.linspace(-1.0, 1.0, size)
        y = np.linspace(-1.0, 1.0, size)
        xx, yy = np.meshgrid(x, y, indexing="ij")

        r_grid = np.sqrt(xx**2 + yy**2)
        coord_theta = np.arctan2(yy, xx)

        # Mask for the disc
        mask = r_grid <= 1.0

        # math_theta = 0 (Down) should be Blue
        # hue mapping matches theta_to_hue exactly
        math_theta = coord_theta + np.pi / 2
        hues = theta_to_hue(math_theta)
        saturations = np.ones_like(hues)
        values = np.full_like(hues, 0.8)
        rgb_data = hsv_to_rgb_array(hues, saturations, values)

        # RGBA image: shape (X, Y, 4) for col-major
        img_data = np.zeros((size, size, 4), dtype=np.uint8)
        img_data[..., :3] = rgb_data
        img_data[..., 3] = (mask * 255).astype(np.uint8)

        self.img = pg.ImageItem(img_data, axisOrder="col-major")
        # Map [0, size] pixels to [-1, 1] plot units
        self.img.setRect(QtCore.QRectF(-1.0, -1.0, 2.0, 2.0))
        self.plot.addItem(self.img)

        # High-visibility Arrow indicating mean direction
        self.arrow = MeanDirectionArrow()
        self.arrow.setZValue(10)
        self.plot.addItem(self.arrow)

        # Set range slightly larger than the disc
        self.plot.setXRange(-1.1, 1.1, padding=0)
        self.plot.setYRange(-1.1, 1.1, padding=0)

    def update_state(self, r: float, mean_cos: float, mean_sin: float) -> None:
        """Update the visualizer with new order parameter data."""
        # Visual X = mean_sin, Visual Y = -mean_cos
        self.arrow.set_vector(r, mean_sin, -mean_cos)


class ColorBarVisualizer(QtWidgets.QWidget):
    """
    Shows legends for Angle -> Hue and Energy -> Brightness mappings.
    Uses native QPainter to ensure visibility and performance.
    """

    def __init__(self, parent: QtWidgets.QWidget | None = None):
        super().__init__(parent=parent)
        self.setFixedHeight(70)

        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(4)

        # Angle Legend
        self.angle_label = QtWidgets.QLabel("Angle (0 \u2192 2\u03c0)")
        self.angle_label.setStyleSheet("font-size: 10px; color: #aaa;")
        layout.addWidget(self.angle_label)

        self.angle_bar = self._GradientWidget(self._get_angle_colors)
        layout.addWidget(self.angle_bar)

        layout.addSpacing(2)

        # Energy Legend
        self.energy_label = QtWidgets.QLabel("Energy (Dark \u2192 Bright)")
        self.energy_label.setStyleSheet("font-size: 10px; color: #aaa;")
        layout.addWidget(self.energy_label)

        self.energy_bar = self._GradientWidget(self._get_energy_colors)
        layout.addWidget(self.energy_bar)

    class _GradientWidget(QtWidgets.QWidget):
        def __init__(self, color_func: Callable[[int], list[QtGui.QColor]]):
            super().__init__()
            self.setFixedHeight(12)
            self.color_func = color_func

        def paintEvent(  # type: ignore[invalid-method-override] # noqa: N802
            self, event: QtGui.QPaintEvent | None
        ) -> None:
            painter = QtGui.QPainter(self)
            width = self.width()
            height = self.height()

            # Draw gradient
            colors = self.color_func(width)
            for x in range(width):
                painter.setPen(colors[x])
                painter.drawLine(x, 0, x, height)

    def _get_angle_colors(self, n: int) -> list[QtGui.QColor]:
        # Rotate hues so blue aligns with external field (theta=0)
        # theta=0 (down, field alignment) -> blue, theta=pi/2 (right) -> red
        hues = np.linspace(0, 1, n)
        # Apply same +4pi/3 rotation as theta_to_hue: shift by +2/3
        hues = (hues + 2.0 / 3.0) % 1.0
        colors = []
        for h in hues:
            colors.append(QtGui.QColor.fromHsvF(float(h), 1.0, 0.8))
        return colors

    def _get_energy_colors(self, n: int) -> list[QtGui.QColor]:
        # Map [0, 5] energy range to colors
        energies = np.linspace(0, 5, n)
        vals = omega_to_value(energies)
        colors = []
        for v in vals:
            # Using red as the representative color for energy ramp
            colors.append(QtGui.QColor.fromHsvF(0, 1.0, float(v)))
        return colors


class InfoPanel(QtWidgets.QWidget):
    """
    Informative panel showing monitoring data and legends.
    """

    def __init__(self, parent: QtWidgets.QWidget | None = None):
        super().__init__(parent=parent)
        self.setMinimumWidth(220)
        main_layout = QtWidgets.QVBoxLayout(self)
        main_layout.setContentsMargins(4, 4, 4, 4)

        # Energy monitor
        self.energy_label = QtWidgets.QLabel("Energy per Rotor: N/A")
        self.energy_label.setStyleSheet("font-weight: bold; font-size: 13px;")
        main_layout.addWidget(self.energy_label)

        self.energy_drift_label = QtWidgets.QLabel("Energy Drift: N/A")
        self.energy_drift_label.setStyleSheet("font-size: 11px; color: #aaa;")
        main_layout.addWidget(self.energy_drift_label)

        main_layout.addSpacing(15)

        # Mean Direction Disc Visualizer
        self.mean_dir_label = QtWidgets.QLabel("Mean Direction:")
        main_layout.addWidget(self.mean_dir_label)
        self.mean_dir_visualizer = MeanDirectionVisualizer()
        main_layout.addWidget(self.mean_dir_visualizer)

        main_layout.addSpacing(10)

        # Color Bar Legend
        self.color_bar = ColorBarVisualizer()
        main_layout.addWidget(self.color_bar)

        main_layout.addSpacing(15)

        # Order parameter plot
        self.order_label = QtWidgets.QLabel(
            '<b style="color: #ffff00;">Order Parameter r</b> | '
            '<b style="color: #00ffff;">Mean Kinetic K</b>:'
        )
        self.order_label.setStyleSheet("font-size: 11px;")
        main_layout.addWidget(self.order_label)

        self.order_plot = pg.PlotWidget()
        self.order_plot.setBackground("k")
        # Minimize internal margins
        self.order_plot.getPlotItem().layout.setContentsMargins(0, 0, 0, 0)

        self.order_plot.showGrid(x=True, y=True, alpha=0.3)
        self.order_plot.setYRange(0, 1.05)
        cast(Any, self.order_plot).setXRange(0, 10, padding=0)
        self.order_plot.setFixedHeight(180)

        # Configure main axes
        font = QtGui.QFont()
        font.setPointSize(8)
        self.order_plot.getAxis("bottom").setTickFont(font)
        self.order_plot.getAxis("bottom").setTickSpacing(5, 5)
        self.order_plot.getAxis("left").setTickFont(font)
        self.order_plot.getAxis("left").setTickSpacing(0.5, 0.5)
        self.order_plot.getAxis("left").setLabel("r", color="y")
        # Reduce axis padding
        self.order_plot.getAxis("left").setWidth(20)

        self.order_curve = self.order_plot.plot(pen=pg.mkPen("y", width=1.5))

        # Secondary axis for Mean Kinetic Energy
        self.kinetic_vb = pg.ViewBox()
        self.order_plot.scene().addItem(self.kinetic_vb)
        self.order_plot.getAxis("right").linkToView(self.kinetic_vb)
        self.kinetic_vb.setXLink(self.order_plot.getViewBox())
        self.order_plot.showAxis("right")
        self.order_plot.getAxis("right").setLabel("K", color="c")
        self.order_plot.getAxis("right").setTickFont(font)
        self.order_plot.getAxis("right").setWidth(20)

        self.kinetic_curve = pg.PlotCurveItem(pen=pg.mkPen("c", width=1.5))
        self.kinetic_vb.addItem(self.kinetic_curve)

        def update_vb():
            self.kinetic_vb.setGeometry(self.order_plot.getViewBox().sceneBoundingRect())

        self.order_plot.getViewBox().sigResized.connect(update_vb)

        main_layout.addWidget(self.order_plot)

        main_layout.addStretch()

    def update_order_plot(self, times: list[float], r_values: list[float], k_values: list[float]) -> None:
        """Update the order parameter and kinetic energy plot with new data."""
        self.order_curve.setData(times, r_values)
        self.kinetic_curve.setData(times, k_values)

        if times:
            t_now = times[-1]
            if t_now > 10:
                view_range = [t_now - 10, t_now]
            else:
                view_range = [0, 10]
            
            cast(Any, self.order_plot).setXRange(view_range[0], view_range[1], padding=0)
            self.kinetic_vb.setXRange(view_range[0], view_range[1], padding=0)

            # Auto-scale kinetic energy axis
            if k_values:
                k_max = max(k_values)
                self.kinetic_vb.setYRange(0, max(0.1, k_max * 1.2))
        else:
            cast(Any, self.order_plot).setXRange(0, 10, padding=0)
            self.kinetic_vb.setXRange(0, 10, padding=0)
            self.kinetic_vb.setYRange(0, 1)


class ControlPanel(QtWidgets.QWidget):
    """
    Control panel for the Rotor Array simulation.
    """

    def __init__(self, parent: QtWidgets.QWidget | None = None):
        super().__init__(parent=parent)
        self.setMinimumWidth(250)
        self.main_layout = QtWidgets.QVBoxLayout(self)

        # Header with Help
        header_layout = QtWidgets.QHBoxLayout()
        self.help_button = QtWidgets.QPushButton("?")
        self.help_button.setFixedWidth(30)
        self.help_button.setToolTip("Show Help")
        header_layout.addStretch()
        header_layout.addWidget(self.help_button)
        self.main_layout.addLayout(header_layout)

        # Lattice side control
        self.l_label = QtWidgets.QLabel("Lattice Side (L):")
        self.l_spin = QtWidgets.QSpinBox()
        self.l_spin.setRange(2, 400)
        self.l_spin.setValue(20)
        self.main_layout.addWidget(self.l_label)
        self.main_layout.addWidget(self.l_spin)

        self.main_layout.addSpacing(10)

        # Initial Conditions Preset
        self.preset_label = QtWidgets.QLabel("Initial Condition Preset:")
        self.preset_combo = QtWidgets.QComboBox()
        for p in PRESETS:
            self.preset_combo.addItem(p.name)
        self.main_layout.addWidget(self.preset_label)
        self.main_layout.addWidget(self.preset_combo)

        # Parameter 1 (k)
        self.k_widget = QtWidgets.QWidget()
        self.k_layout = QtWidgets.QHBoxLayout(self.k_widget)
        self.k_layout.setContentsMargins(0, 0, 0, 0)
        self.k_label = QtWidgets.QLabel("Winding (k):")
        self.k_spin = QtWidgets.QDoubleSpinBox()
        self.k_spin.setRange(-250.0, 250.0)
        self.k_spin.setDecimals(2)
        self.k_spin.setValue(1.0)
        self.k_layout.addWidget(self.k_label)
        self.k_layout.addWidget(self.k_spin)
        self.main_layout.addWidget(self.k_widget)

        # Parameter 2 (p2)
        self.p2_widget = QtWidgets.QWidget()
        self.p2_layout = QtWidgets.QHBoxLayout(self.p2_widget)
        self.p2_layout.setContentsMargins(0, 0, 0, 0)
        self.p2_label = QtWidgets.QLabel("Width (w):")
        self.p2_spin = QtWidgets.QDoubleSpinBox()
        self.p2_spin.setRange(1.0, 1000.0)
        self.p2_spin.setDecimals(0)
        self.p2_spin.setValue(1.0)
        self.p2_layout.addWidget(self.p2_label)
        self.p2_layout.addWidget(self.p2_spin)
        self.main_layout.addWidget(self.p2_widget)

        # Parameter 3 (p3)
        self.p3_widget = QtWidgets.QWidget()
        self.p3_layout = QtWidgets.QHBoxLayout(self.p3_widget)
        self.p3_layout.setContentsMargins(0, 0, 0, 0)
        self.p3_label = QtWidgets.QLabel("Shift (\u03b4\u03c6):")
        self.p3_spin = QtWidgets.QDoubleSpinBox()
        self.p3_spin.setRange(-np.pi, np.pi)
        self.p3_spin.setDecimals(2)
        self.p3_spin.setValue(0.0)
        self.p3_layout.addWidget(self.p3_label)
        self.p3_layout.addWidget(self.p3_spin)
        self.main_layout.addWidget(self.p3_widget)

        # Initialize visibility
        self.k_widget.setVisible(False)
        self.p2_widget.setVisible(False)
        self.p3_widget.setVisible(False)

        # Connect internal visibility toggle
        self.preset_combo.currentIndexChanged.connect(self._handle_preset_ui_change)

        self.main_layout.addSpacing(10)

        # J coupling slider
        self.j_label = QtWidgets.QLabel("Coupling (J): 1.00")
        self.j_slider = QtWidgets.QSlider(QtCore.Qt.Orientation.Horizontal)
        self.j_slider.setRange(0, 2000)  # 0.0 to 20.0
        self.j_slider.setValue(100)
        self.j_slider.valueChanged.connect(self._on_j_changed)
        self.main_layout.addWidget(self.j_label)
        self.main_layout.addWidget(self.j_slider)

        # M field slider
        self.m_label = QtWidgets.QLabel("Field (M): 0.00")
        self.m_slider = QtWidgets.QSlider(QtCore.Qt.Orientation.Horizontal)
        self.m_slider.setRange(0, 2000)  # 0.0 to 20.0
        self.m_slider.setValue(0)
        self.m_slider.valueChanged.connect(self._on_m_changed)
        self.main_layout.addWidget(self.m_label)
        self.main_layout.addWidget(self.m_slider)

        # Time Scale slider
        self.time_label = QtWidgets.QLabel("Time Scale: 1.0x")
        self.time_slider = QtWidgets.QSlider(QtCore.Qt.Orientation.Horizontal)
        self.time_slider.setRange(10, 500)  # 0.1x to 5.0x
        self.time_slider.setValue(100)
        self.time_slider.valueChanged.connect(self._on_time_changed)
        self.main_layout.addWidget(self.time_label)
        self.main_layout.addWidget(self.time_slider)

        # Initial Temperature (Noise) slider
        self.temp_label = QtWidgets.QLabel("Initial Temp (T): 0.00")
        self.temp_slider = QtWidgets.QSlider(QtCore.Qt.Orientation.Horizontal)
        self.temp_slider.setRange(0, 200)  # 0.0 to 2.0
        self.temp_slider.setValue(0)
        self.temp_slider.valueChanged.connect(self._on_temp_changed)
        self.main_layout.addWidget(self.temp_label)
        self.main_layout.addWidget(self.temp_slider)

        # Direction Arrows toggle
        self.arrows_checkbox = QtWidgets.QCheckBox("Show Direction Arrows")
        self.arrows_checkbox.setToolTip(
            "Show arrows indicating rotor angle (auto-disabled when L>60)"
        )
        self.main_layout.addWidget(self.arrows_checkbox)

        self.main_layout.addSpacing(20)

        # Numba acceleration toggle
        self.numba_checkbox = QtWidgets.QCheckBox("Enable Numba Acceleration")
        self.numba_checkbox.setToolTip("Use Numba-optimized physics kernel if available.")
        self.main_layout.addWidget(self.numba_checkbox)

        # Taichi acceleration toggle
        self.taichi_checkbox = QtWidgets.QCheckBox("Use Taichi (GPU) Physics")
        self.taichi_checkbox.setToolTip("Use Taichi-optimized GPU physics kernel if available.")
        self.main_layout.addWidget(self.taichi_checkbox)

        # OpenGL renderer toggle
        self.opengl_checkbox = QtWidgets.QCheckBox("Use OpenGL Renderer")
        self.opengl_checkbox.setToolTip("Use pyqtgraph.opengl for rendering if available.")
        self.main_layout.addWidget(self.opengl_checkbox)

        # Buttons
        self.start_stop_button = QtWidgets.QPushButton("Start")
        self.start_stop_button.setCheckable(True)
        self.main_layout.addWidget(self.start_stop_button)

        self.reset_button = QtWidgets.QPushButton("Reset")
        self.main_layout.addWidget(self.reset_button)

        self.main_layout.addStretch()

        # Callbacks for external connection
        self.j_callback: Callable[[float], None] = lambda x: None
        self.m_callback: Callable[[float], None] = lambda x: None
        self.time_callback: Callable[[float], None] = lambda x: None
        self.arrows_callback: Callable[[bool], None] = lambda x: None
        self.numba_callback: Callable[[bool], None] = lambda x: None
        self.taichi_callback: Callable[[bool], None] = lambda x: None
        self.opengl_callback: Callable[[bool], None] = lambda x: None

        # Connect arrows checkbox
        self.arrows_checkbox.stateChanged.connect(self._on_arrows_changed)
        self.numba_checkbox.stateChanged.connect(self._on_numba_changed)
        self.taichi_checkbox.stateChanged.connect(self._on_taichi_changed)
        self.opengl_checkbox.stateChanged.connect(self._on_opengl_changed)

    def _handle_preset_ui_change(self, index: int) -> None:
        preset_name = self.preset_combo.currentText()
        p = get_preset_by_name(preset_name)
        l_side = self.l_spin.value()

        # Update K control
        self.k_label.setText(p.k_label)
        self.k_spin.setDecimals(p.k_decimals)
        self.k_spin.setSingleStep(p.k_step)
        self.k_spin.setRange(p.k_min, p.k_max)

        k_val = p.k_default(l_side) if callable(p.k_default) else p.k_default
        self.k_spin.setValue(float(k_val))

        # Update P2 control
        if p.p2_label:
            self.p2_label.setText(p.p2_label)
            self.p2_spin.setDecimals(p.p2_decimals)
            self.p2_spin.setSingleStep(p.p2_step)
            self.p2_spin.setRange(p.p2_min, p.p2_max)
            p2_val = p.p2_default(l_side) if callable(p.p2_default) else p.p2_default
            self.p2_spin.setValue(float(p2_val))
            self.p2_widget.setVisible(True)
        else:
            self.p2_widget.setVisible(False)

        # Update P3 control
        if p.p3_label:
            self.p3_label.setText(p.p3_label)
            self.p3_spin.setDecimals(p.p3_decimals)
            self.p3_spin.setSingleStep(p.p3_step)
            self.p3_spin.setRange(p.p3_min, p.p3_max)
            p3_val = p.p3_default(l_side) if callable(p.p3_default) else p.p3_default
            self.p3_spin.setValue(float(p3_val))
            self.p3_widget.setVisible(True)
        else:
            self.p3_widget.setVisible(False)

        # Always show K if it's not the default "Parameter:" or if it's explicitly needed
        show_k = preset_name not in [
            "Random Angles",
            "Domain Wall",
            "Pi/2 Domain Wall",
            "Cross Domain",
        ]
        self.k_widget.setVisible(show_k)

    def _on_j_changed(self, value: int) -> None:
        j = value / 100.0
        self.j_label.setText(f"Coupling (J): {j:.2f}")
        self.j_callback(j)

    def _on_m_changed(self, value: int) -> None:
        m = value / 100.0
        self.m_label.setText(f"Field (M): {m:.2f}")
        self.m_callback(m)

    def _on_time_changed(self, value: int) -> None:
        scale = value / 100.0
        self.time_label.setText(f"Time Scale: {scale:.1f}x")
        self.time_callback(scale)

    def _on_temp_changed(self, value: int) -> None:
        t = value / 100.0
        self.temp_label.setText(f"Initial Temp (T): {t:.2f}")

    def set_j_callback(self, callback: Callable[[float], None]) -> None:
        self.j_callback = callback

    def set_m_callback(self, callback: Callable[[float], None]) -> None:
        self.m_callback = callback

    def set_time_callback(self, callback: Callable[[float], None]) -> None:
        self.time_callback = callback

    def set_arrows_callback(self, callback: Callable[[bool], None]) -> None:
        """Set callback for arrow visibility toggle.

        Args:
            callback: Function called with boolean (True=show arrows, False=hide).
        """
        self.arrows_callback = callback

    def _on_arrows_changed(self, state: int) -> None:
        """Handle arrow checkbox state change."""
        self.arrows_callback(state == QtCore.Qt.CheckState.Checked.value)

    def set_arrows_checked(self, checked: bool) -> None:
        """Programmatically set the arrows checkbox state.

        Args:
            checked: True to check the box, False to uncheck.
        """
        self.arrows_checkbox.setChecked(checked)

    def set_numba_checked(self, checked: bool) -> None:
        """Programmatically set the numba checkbox state."""
        self.numba_checkbox.setChecked(checked)

    def set_numba_enabled(self, enabled: bool) -> None:
        """Enable/disable the numba toggle if support is unavailable."""
        self.numba_checkbox.setEnabled(enabled)

    def set_taichi_checked(self, checked: bool) -> None:
        """Programmatically set the Taichi checkbox state."""
        self.taichi_checkbox.setChecked(checked)

    def set_taichi_enabled(self, enabled: bool) -> None:
        """Enable/disable the Taichi toggle if support is unavailable."""
        self.taichi_checkbox.setEnabled(enabled)

    def set_opengl_checked(self, checked: bool) -> None:
        """Programmatically set the OpenGL checkbox state."""
        self.opengl_checkbox.setChecked(checked)

    def set_opengl_enabled(self, enabled: bool) -> None:
        """Enable/disable the OpenGL toggle if support is unavailable."""
        self.opengl_checkbox.setEnabled(enabled)

    def set_numba_callback(self, callback: Callable[[bool], None]) -> None:
        """Set callback for numba acceleration toggle."""
        self.numba_callback = callback

    def set_taichi_callback(self, callback: Callable[[bool], None]) -> None:
        """Set callback for Taichi acceleration toggle."""
        self.taichi_callback = callback

    def set_opengl_callback(self, callback: Callable[[bool], None]) -> None:
        """Set callback for OpenGL renderer toggle."""
        self.opengl_callback = callback

    def _on_numba_changed(self, state: int) -> None:
        """Handle numba checkbox state change."""
        self.numba_callback(state == QtCore.Qt.CheckState.Checked.value)

    def _on_taichi_changed(self, state: int) -> None:
        """Handle Taichi checkbox state change."""
        self.taichi_callback(state == QtCore.Qt.CheckState.Checked.value)

    def _on_opengl_changed(self, state: int) -> None:
        """Handle OpenGL checkbox state change."""
        self.opengl_callback(state == QtCore.Qt.CheckState.Checked.value)

    def set_simulation_running(self, running: bool) -> None:
        """Enable or disable controls that should not be changed during simulation."""
        self.l_spin.setEnabled(not running)
        self.preset_combo.setEnabled(not running)
        self.k_spin.setEnabled(not running)
        self.p2_spin.setEnabled(not running)
        self.p3_spin.setEnabled(not running)
        self.temp_slider.setEnabled(not running)
        self.numba_checkbox.setEnabled(not running)
        self.taichi_checkbox.setEnabled(not running)

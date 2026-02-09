import numpy as np


def theta_to_hue(theta: np.ndarray) -> np.ndarray:
    """
    Map angles in radians to HSV hues in [0, 1].

    Rotated mapping: blue aligns with external field (theta=0).
    theta=0 (down, field alignment) -> blue, theta=pi/2 (right) -> red.
    """
    # Rotate by +4pi/3 so theta=0 maps to hue=2/3 (blue)
    return ((theta + 4 * np.pi / 3) % (2 * np.pi)) / (2 * np.pi)


def omega_to_value(omega_sq: np.ndarray, val_min: float = 0.2, val_max: float = 0.8) -> np.ndarray:
    """
    Map kinetic energy (omega^2) to brightness values in [val_min, val_max].

    Uses a hyperbolic tangent to softly saturate high energy values.
    """
    # Use tanh to map energy to [0, 1] softly
    energy_factor = np.tanh(omega_sq / 5.0)
    return val_min + (val_max - val_min) * energy_factor


def hsv_to_rgb_array(hues: np.ndarray, saturations: np.ndarray, values: np.ndarray) -> np.ndarray:
    """
    Vectorized HSV to RGB conversion.
    Input arrays should have the same shape and values in [0, 1].
    Returns an array of shape (..., 3) with values in [0, 255].
    """
    # Simple vectorized HSV to RGB implementation
    h = hues * 6.0
    i = h.astype(int)
    f = h - i

    p = values * (1.0 - saturations)
    q = values * (1.0 - saturations * f)
    t = values * (1.0 - saturations * (1.0 - f))

    i = i % 6

    rgb = np.zeros(hues.shape + (3,))

    # Masks for each segment
    m0 = i == 0
    m1 = i == 1
    m2 = i == 2
    m3 = i == 3
    m4 = i == 4
    m5 = i == 5

    rgb[m0] = np.stack([values[m0], t[m0], p[m0]], axis=-1)
    rgb[m1] = np.stack([q[m1], values[m1], p[m1]], axis=-1)
    rgb[m2] = np.stack([p[m2], values[m2], t[m2]], axis=-1)
    rgb[m3] = np.stack([p[m3], q[m3], values[m3]], axis=-1)
    rgb[m4] = np.stack([t[m4], p[m4], values[m4]], axis=-1)
    rgb[m5] = np.stack([values[m5], p[m5], q[m5]], axis=-1)

    return (rgb * 255).astype(np.uint8)

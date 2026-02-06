from collections.abc import Callable
from typing import NamedTuple

import numpy as np


class PresetInfo(NamedTuple):
    name: str
    k_label: str = "Parameter:"
    k_decimals: int = 2
    k_step: float = 0.1
    k_min: float = -1000.0
    k_max: float = 1000.0
    k_default: float | Callable[[int], float] = 1.0

    p2_label: str | None = None
    p2_decimals: int = 0
    p2_step: float = 1.0
    p2_min: float = 1.0
    p2_max: float = 1000.0
    p2_default: float | Callable[[int], float] = 1.0

    p3_label: str | None = None
    p3_decimals: int = 2
    p3_step: float = 0.1
    p3_min: float = -np.pi
    p3_max: float = np.pi
    p3_default: float | Callable[[int], float] = 0.0


PRESETS = [
    PresetInfo(name="Random Angles"),
    PresetInfo(name="Twisted", k_label="Winding (k):", k_decimals=0, k_step=1.0, k_default=1.0),
    PresetInfo(name="Domain Wall"),
    PresetInfo(
        name="Vortex Band",
        k_label="Wraps (k):",
        k_decimals=0,
        k_step=1.0,
        k_default=1.0,
        p2_label="Width (w):",
        p2_default=1.0,
        p3_label="Shift (\u03b4\u03c6):",
        p3_default=0.0,
    ),
    PresetInfo(name="Cross Domain"),
    PresetInfo(
        name="Vortex Pair",
        k_label="Separation:",
        k_decimals=1,
        k_step=1.0,
        k_default=lambda l_side: float(l_side // 2),
    ),
    PresetInfo(
        name="Skyrmion",
        k_label="Radius (\u03c3):",
        k_decimals=1,
        k_step=1.0,
        k_default=lambda l_side: max(2.0, float(l_side) / 5.0),
    ),
    PresetInfo(
        name="Single Kick",
        k_label="Velocity (\u03c9):",
        k_decimals=2,
        k_step=0.1,
        k_default=5.0,
    ),
    PresetInfo(
        name="Thermalized",
        k_label="Mean Energy (\u03b5):",
        k_decimals=2,
        k_step=0.1,
        k_default=1.0,
        k_min=0.0,
    ),
]


def get_preset_by_name(name: str) -> PresetInfo:
    for p in PRESETS:
        if p.name == name:
            return p
    return PRESETS[0]


def generate_initial_state(
    l_side: int, preset_name: str, k: float, p2: float, p3: float, temp: float
) -> np.ndarray:
    """Generate initial state based on the selected preset and parameters."""
    n = l_side**2
    y0 = np.zeros(2 * n)

    if preset_name == "Random Angles":
        # theta_i from [-pi, pi)
        y0[:n] = np.random.uniform(-np.pi, np.pi, n)
    elif preset_name == "Twisted":
        # theta_i,j = 2*pi*k*i/L (twist along x)
        i_indices = np.arange(l_side).repeat(l_side).reshape(l_side, l_side).T.flatten()
        y0[:n] = (2 * np.pi * k * i_indices) / l_side
    elif preset_name == "Domain Wall":
        # Half at 0, half at pi (split along x)
        theta_2d = np.zeros((l_side, l_side))
        half = l_side // 2
        theta_2d[half:, :] = np.pi
        y0[:n] = theta_2d.flatten()
        # Tiny velocity perturbation to break unstable equilibrium
        y0[n] = 1e-6
    elif preset_name == "Vortex Band":
        # A vertical band of phase ramps
        theta_2d = np.zeros((l_side, l_side))
        w = int(p2)
        delta_phi = p3

        mid = l_side // 2
        start = max(0, mid - w // 2)
        end = min(l_side, start + w)

        # Phase ramp along y
        ramp = np.linspace(0, 2 * np.pi * k, l_side, endpoint=False)

        for j in range(start, end):
            # Apply ramp and inter-line phase shift
            theta_2d[:, j] = ramp + (j - start) * delta_phi

        y0[:n] = theta_2d.flatten()
    elif preset_name == "Cross Domain":
        # Four triangular domains (Upper/Lower = pi/2, Left/Right = -pi/2)
        theta_2d = np.zeros((l_side, l_side))
        yy, xx = np.indices((l_side, l_side))
        # Diagonals: y=x and y=L-1-x
        mask_upper = (yy < xx) & (yy < (l_side - 1 - xx))
        mask_lower = (yy > xx) & (yy > (l_side - 1 - xx))
        mask_left = (yy > xx) & (yy < (l_side - 1 - xx))
        mask_right = (yy < xx) & (yy > (l_side - 1 - xx))

        theta_2d[mask_upper] = np.pi / 2
        theta_2d[mask_lower] = np.pi / 2
        theta_2d[mask_left] = -np.pi / 2
        theta_2d[mask_right] = -np.pi / 2
        y0[:n] = theta_2d.flatten()
    elif preset_name == "Vortex Pair":
        # Two opposite vortices
        yy, xx = np.indices((l_side, l_side))
        mid_f = (l_side - 1) / 2.0
        sep = k / 2.0

        # Vortex at (mid - sep, mid), Antivortex at (mid + sep, mid)
        v1 = np.arctan2(yy - mid_f, xx - (mid_f - sep))
        v2 = np.arctan2(yy - mid_f, xx - (mid_f + sep))
        y0[:n] = (v1 - v2).flatten()
    elif preset_name == "Skyrmion":
        # Localized phase twist
        yy, xx = np.indices((l_side, l_side))
        mid_f = (l_side - 1) / 2.0
        sigma_f = float(k)
        r_sq = (xx - mid_f) ** 2 + (yy - mid_f) ** 2
        y0[:n] = (np.pi * np.exp(-r_sq / (2 * sigma_f**2))).flatten()
    elif preset_name == "Single Kick":
        # Gaussian velocity kick (Wave Packet)
        yy, xx = np.indices((l_side, l_side))
        mid_f = (l_side - 1) / 2.0
        omega_peak = k
        # Fixed width for the kick "drop"
        sigma_f = 2.0
        r_sq = (xx - mid_f) ** 2 + (yy - mid_f) ** 2
        kick = omega_peak * np.exp(-r_sq / (2 * sigma_f**2))
        y0[n:] = kick.flatten()
    elif preset_name == "Thermalized":
        # Random velocities (Maxwell-Boltzmann like)
        sigma_f = np.sqrt(max(0, 2 * k))
        y0[n:] = np.random.normal(0, sigma_f, n)

    # Add Thermal Noise Overlay (Phonons)
    if temp > 0:
        # sigma = sqrt(2 * T)
        noise_sigma = np.sqrt(2.0 * temp)
        y0[n:] += np.random.normal(0, noise_sigma, n)

    # Wrap theta to [-pi, pi)
    y0[:n] = (y0[:n] + np.pi) % (2 * np.pi) - np.pi

    return y0

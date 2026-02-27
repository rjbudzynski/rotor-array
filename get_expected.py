import numpy as np
from colors import theta_to_hue, omega_to_value, hsv_to_rgb_array

def get_expected():
    theta = np.array([0.0])
    omega = np.array([0.0])
    
    hue = theta_to_hue(theta)
    val = omega_to_value(omega**2)
    rgb = hsv_to_rgb_array(hue, np.ones_like(hue), val)
    print(f"Expected color for theta=0, omega=0: {rgb[0]}")

if __name__ == "__main__":
    get_expected()

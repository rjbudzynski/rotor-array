import numpy as np
import taichi as ti

ti.init(arch=ti.gpu)

@ti.kernel
def get_pixel() -> ti.types.vector(4, ti.u8):
    # Pure red: H=0 -> R=255, G=0, B=0
    r, g, b = 1.0, 0.0, 0.0
    return ti.Vector([
        ti.cast(r * 255, ti.u8),
        ti.cast(g * 255, ti.u8),
        ti.cast(b * 255, ti.u8),
        ti.cast(255, ti.u8)
    ])

if __name__ == "__main__":
    p = get_pixel()
    print(f"Red Pixel Bytes: {list(p)}")
    
    # Check field storage
    f = ti.Vector.field(4, dtype=ti.u8, shape=(1, 1))
    f[0, 0] = p
    arr = f.to_numpy()
    print(f"Field to_numpy[0,0]: {arr[0, 0]}")

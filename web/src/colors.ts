export function thetaToHue(theta: number): number {
    let h = (theta % (2 * Math.PI)) / (2 * Math.PI);
    if (h < 0) h += 1;
    return h;
}

export function omegaToValue(omegaSq: number, valMin = 0.2, valMax = 0.8): number {
    const energyFactor = Math.tanh(omegaSq / 5.0);
    return valMin + (valMax - valMin) * energyFactor;
}

export function hsvToRgb(h: number, s: number, v: number, out: Uint8Array | Uint8ClampedArray, offset: number) {
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    
    let r=0, g=0, b=0;
    const ii = i % 6;
    
    switch(ii) {
        case 0: r=v; g=t; b=p; break;
        case 1: r=q; g=v; b=p; break;
        case 2: r=p; g=v; b=t; break;
        case 3: r=p; g=q; b=v; break;
        case 4: r=t; g=p; b=v; break;
        case 5: r=v; g=p; b=q; break;
    }
    
    out[offset] = Math.floor(r * 255);
    out[offset+1] = Math.floor(g * 255);
    out[offset+2] = Math.floor(b * 255);
}

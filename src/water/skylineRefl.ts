import * as THREE from 'three';
import { buildings, WATER_Y } from '../sim';
import { ISLAND, islandH } from '../seaWorld';

/* Reflection illusion (Shifat Oct 31 12:58 'illusion of reflection, super performant for all devices'). Nothing is rendered: the skyline
   around the camera (city + harbor towers from the building list, the island's hills) is projected on the CPU into a 512-px ring
   - per azimuth: the silhouette's top elevation (alpha) and its colour - and re-projected only when the camera has moved ~30 m.
   The sea reads it with ONE texture fetch along its rippled reflection ray, heavily softened and tinted (src/water/common.ts look). */
export const SKYLINE_N = 512, SKY_EL_MAX = 0.35;
const data = new Uint8Array(SKYLINE_N * 4);
export const SKYLINE_TEX = new THREE.DataTexture(data, SKYLINE_N, 1, THREE.RGBAFormat);
SKYLINE_TEX.wrapS = THREE.RepeatWrapping; SKYLINE_TEX.magFilter = SKYLINE_TEX.minFilter = THREE.LinearFilter; SKYLINE_TEX.needsUpdate = true;
const el = new Float32Array(SKYLINE_N), cr = new Float32Array(SKYLINE_N), cg = new Float32Array(SKYLINE_N), cb = new Float32Array(SKYLINE_N);
const PAL = [[0.74, 0.76, 0.8], [0.62, 0.65, 0.7], [0.8, 0.76, 0.7], [0.55, 0.58, 0.64], [0.7, 0.72, 0.68], [0.72, 0.6, 0.55], [0.82, 0.82, 0.85]];   // sunlit facades: brighter than the blue water they lie on, so the mirrored skyline reads as pale streaks (like a real bay at noon)
const TAU = Math.PI * 2;
const bin = (a: number) => (((Math.round((a / TAU + 0.5) * SKYLINE_N) % SKYLINE_N) + SKYLINE_N) % SKYLINE_N);
function put(a0: number, a1: number, e: number, r: number, g: number, b: number) {
    let d = a1 - a0; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
    const n = Math.max(1, Math.ceil(Math.abs(d) / TAU * SKYLINE_N)), s = d / n;
    for (let k = 0; k <= n; k++) { const i = bin(a0 + s * k); if (e > el[i]) { el[i] = e; cr[i] = r; cg[i] = g; cb[i] = b; } }
}
export function projectSkyline(cx: number, cz: number) {
    el.fill(0);
    for (let i = 0; i < buildings.length; i++) {
        const b = buildings[i]; if (b.host !== undefined) continue;
        const mx = (b.x0 + b.x1) * 0.5 - cx, mz = (b.z0 + b.z1) * 0.5 - cz, dist = Math.max(8, Math.hypot(mx, mz) - 0.5 * Math.hypot(b.x1 - b.x0, b.z1 - b.z0));
        if (dist > 1600) continue;
        const e = Math.atan2((b.y0 || 0) + b.h - WATER_Y, dist); if (e < 0.004) continue;
        const a = [Math.atan2(b.x0 - cx, b.z0 - cz), Math.atan2(b.x1 - cx, b.z0 - cz), Math.atan2(b.x0 - cx, b.z1 - cz), Math.atan2(b.x1 - cx, b.z1 - cz)];
        let lo = a[0], hi = a[0]; for (const v of a) { let dv = v - a[0]; if (dv > Math.PI) dv -= TAU; if (dv < -Math.PI) dv += TAU; lo = Math.min(lo, a[0] + dv); hi = Math.max(hi, a[0] + dv); }
        const p = PAL[(i * 2654435761 >>> 0) % PAL.length]; put(lo, hi, e, p[0], p[1], p[2]);
    }
    const R = ISLAND.R * 1.15;
    for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) {
        const x = ISLAND.cx + i / 6 * R, z = ISLAND.cz + j / 6 * R, h = islandH(x, z); if (h == null || h < WATER_Y + 0.5) continue;
        const dx = x - cx, dz = z - cz, dist = Math.max(10, Math.hypot(dx, dz)), a = Math.atan2(dx, dz), w = (R / 6) / dist;
        put(a - w, a + w, Math.atan2(h - WATER_Y, dist), 0.16, 0.42, 0.2);
    }
    for (let i = 0; i < SKYLINE_N; i++) { const o = i * 4; data[o] = cr[i] * 255; data[o + 1] = cg[i] * 255; data[o + 2] = cb[i] * 255; data[o + 3] = Math.min(255, el[i] / SKY_EL_MAX * 255); }
    SKYLINE_TEX.needsUpdate = true;
}

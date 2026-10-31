import * as THREE from 'three';
import { SEA, WATER_Z, HALF, seabedAt } from '../sim';
import { CAUSTIC_TEX, CAUSTIC_GLSL } from '../caustics';
import { TOD, UWF } from '../world/env';

// seabed: sand with animated caustic light lines, fading into teal haze with distance (reference: two underwater game shots - sandy floor with web-like caustic lines, cyan fading to deeper teal)
const mkSea = (xy: boolean) => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFog: UWF, uCaus: { value: CAUSTIC_TEX }, uDayC: TOD.day },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying vec3 vW; uniform float uTime; uniform vec3 uFog;
    // Shifat 3:43 AM 'refracted caustic patterns are best, use them underwater too': the SAME simulated ray-splat caustic tile + causRGB the
    // ocean's refracted view uses (same scale, speed, gain), so the seabed looks identical from above and below. Also far cheaper than the old 24-call warp.
    ${CAUSTIC_GLSL}
    uniform float uDayC;
    vec3 cau3(vec2 p){ return causRGB(p * 0.5 / 0.9, uTime * 0.8) * 2.6; }
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){ vec3 fogDisplay=linearToOutputTexel(vec4(uFog,1.0)).rgb; vec3 fogUsed=mix(uFog,fogDisplay,0.65*(1.0-smoothstep(-2.0,-1.0,cameraPosition.y))); vec2 p = ${xy ? 'vW.xy' : 'vW.xz'} * 0.9; float depthK = mix(1.0, 0.3, smoothstep(-10.0, -48.0, vW.y)); vec3 c3 = cau3(p) * exp(-max(-1.0 - vW.y, 0.0) * 0.10) * 1.25 * uDayC * step(cameraPosition.y, -1.0);   /* sunlight only, and only seen from below (from above the ocean shader draws them) */ float c = dot(c3, vec3(0.333));
      vec3 sand = mix(vec3(0.46, 0.62, 0.58), vec3(0.58, 0.70, 0.62), h(floor(${xy ? 'vW.xy' : 'vW.xz'} * 3.0)) * 0.6);
      vec3 col = sand * 0.7 * (0.82 + c3);   /* same light model as the refracted bed: albedo * (0.82 + caustics) */
      float d = length(vW - cameraPosition); vec3 Tb = exp(-vec3(0.45, 0.07, 0.02) * d * 0.12); col = col * Tb; float fg = smoothstep(45.0, 190.0, d);   /* far-only underwater fog (Shifat Oct 29) */ ${xy ? 'fg = fg * 0.8;' : ''} col = col * (1.0 - 0.4 * fg) + fogUsed * fg * 0.9; ${xy ? 'col = mix(col, fogUsed, smoothstep(-6.0, -0.6, vW.y));' : ''}
      ${xy ? `// Match grazing rays at the wall/surface junction without changing the deeper sand wall.
      vec3 ray=normalize(cameraPosition-vW);vec3 junction=fogUsed*(1.0+0.9*pow(1.0-clamp(abs(ray.y),0.0,1.0),2.5));
      col=mix(col,junction,smoothstep(-5.0,-0.6,vW.y));` : ''}
      gl_FragColor = vec4(col, 1.0); }`,
});
export const seabedMat = mkSea(false), wallMat = mkSea(true);

// Greater ocean: a camera-following sea sheet whose grid is dense under the camera and coarse toward the horizon (one mesh, no extra
// draw calls). The vertex shader folds anything north of the shoreline onto it, so the sheet never covers land.
export const OCEAN_HALF = 1500, OCEAN_SNAP = 8;   // South Sea 3: 900 -> 1500 so the sheet reaches past the raised far plane (no seabed band at the horizon)
export const OCEAN_N = 170, OCEAN_WARP = 2.1;
export function oceanGeo() {
    const n = OCEAN_N, pos: number[] = [], idx: number[] = [];   /* keep 170: 124 made the camera-follow snap visibly shift the coarser wave mesh (Shifat 4:40 AM 'sea is glitching') */
    const warp = (u: number) => Math.sign(u) * Math.pow(Math.abs(u), OCEAN_WARP) * OCEAN_HALF;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push(warp(i / n * 2 - 1), 0, warp(j / n * 2 - 1));
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + n + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}
// Seabed with the real depth profile (shelf -> slope -> trench), shared with the swim floor in the sim.
export function seabedGeo() {
    const nx = 80, nz = 110, x0 = -(HALF + 500), x1 = HALF + 500, z0 = WATER_Z + 1, z1 = SEA.zMin - 450, pos: number[] = [], idx: number[] = [];
    for (let j = 0; j <= nz; j++) { const tz = j / nz, z = z0 + (z1 - z0) * Math.pow(tz, 1.25); for (let i = 0; i <= nx; i++) { const x = x0 + (x1 - x0) * i / nx; pos.push(x, Math.min(seabedAt(x, z), -3.2), z); } }   // the island's own terrain mesh covers anything shallower
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + nx + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

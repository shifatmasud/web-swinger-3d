import { occludeFade } from './occlude';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import heroData from './hero.json';
import { tagLights } from './robotgeo';
// Shadow-body robots: the hero's own body mesh (same proportions), recoloured to a robot palette (no suit texture, no hood),
// with a clean visor plate and two eye slits (no mouth, no nose), armour plates and joint blocks. Legs and arms swing in the vertex shader.
export type RGB = [number, number, number];
export interface ShadowOpts { shell: RGB; accent: RGB; eye: RGB; heavy?: boolean; cell?: number; }
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: RGB) => {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); g.deleteAttribute('uv');
    const n = g.attributes.position.count, col = new Float32Array(n * 3); for (let i = 0; i < n; i++) { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
};
export function shadowGeo(o: ShadowOpts) {
    const d: any = heroData, P: number[] = d.pos, n = P.length / 3, S = o.shell, A = o.accent;
    const D: RGB = [S[0] * 0.42, S[1] * 0.42, S[2] * 0.45], M: RGB = [S[0] * 0.75, S[1] * 0.75, S[2] * 0.78], K: RGB = [0.05, 0.05, 0.06];
    const g = new THREE.BufferGeometry(); const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], ax = Math.abs(x);
        let c: RGB;
        if (y > 1.66) c = S;                              // helmet
        else if (ax > 0.27 && y > 0.92) c = (y < 1.3 ? M : D);   // arms
        else if (y > 1.0) c = (Math.floor(y * 14) & 1) ? S : M;  // torso panels
        else if (y < 0.18) c = K;                         // feet
        else c = (y < 0.62 ? D : M);                      // shins dark, thighs mid
        col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    // vertex-cluster decimation: bots are seen small and the outline hull doubles every triangle, so the 6.7k-triangle hero mesh is merged on a grid (cell in metres, 0 = off)
    const cell = o.cell ?? 0.045; let pos = P, nor: number[] = d.nor, cl = col, idx: number[] = d.idx;
    if (cell > 0) {
        const map = new Map<string, number>(), remap = new Int32Array(n), sp: number[] = [], sn: number[] = [], sc: number[] = [], cnt: number[] = [];
        for (let i = 0; i < n; i++) {
            const key = Math.round(P[i * 3] / cell) + ',' + Math.round(P[i * 3 + 1] / cell) + ',' + Math.round(P[i * 3 + 2] / cell) + ',' + (col[i * 3] * 20 | 0) + (col[i * 3 + 1] * 20 | 0);
            let k = map.get(key); if (k === undefined) { k = cnt.length; map.set(key, k); cnt.push(0); sp.push(0, 0, 0); sn.push(0, 0, 0); sc.push(0, 0, 0); }
            remap[i] = k; cnt[k]++; for (let j = 0; j < 3; j++) { sp[k * 3 + j] += P[i * 3 + j]; sn[k * 3 + j] += d.nor[i * 3 + j]; sc[k * 3 + j] += col[i * 3 + j]; }
        }
        pos = []; nor = []; const c2: number[] = [];
        for (let k = 0; k < cnt.length; k++) { const m = cnt[k], l = Math.hypot(sn[k * 3], sn[k * 3 + 1], sn[k * 3 + 2]) || 1; pos.push(sp[k * 3] / m, sp[k * 3 + 1] / m, sp[k * 3 + 2] / m); nor.push(sn[k * 3] / l, sn[k * 3 + 1] / l, sn[k * 3 + 2] / l); c2.push(sc[k * 3] / m, sc[k * 3 + 1] / m, sc[k * 3 + 2] / m); }
        idx = []; for (let i = 0; i < d.idx.length; i += 3) { const a = remap[d.idx[i]], b = remap[d.idx[i + 1]], c = remap[d.idx[i + 2]]; if (a !== b && b !== c && a !== c) idx.push(a, b, c); }
        cl = new Float32Array(c2);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(cl as Float32Array, 3)); g.setIndex(idx);
    const h = o.heavy ? 1 : 0, parts: THREE.BufferGeometry[] = [g];
    // clean face plate with two eye slits, nothing else on the face
    parts.push(box(0.27, 0.13, 0.03, 0, 1.86, 0.30, K), box(0.07, 0.035, 0.03, -0.065, 1.865, 0.325, o.eye), box(0.07, 0.035, 0.03, 0.065, 1.865, 0.325, o.eye));
    parts.push(box(0.2 + h * 0.08, 0.1 + h * 0.04, 0.28 + h * 0.06, -0.37, 1.64, 0, A), box(0.2 + h * 0.08, 0.1 + h * 0.04, 0.28 + h * 0.06, 0.37, 1.64, 0, A));   // pauldrons
    parts.push(box(0.5, 0.32, 0.07, 0, 1.42, 0.21, A), box(0.36, 0.4, 0.15, 0, 1.4, -0.26, D));   // chest plate, back pack
    for (const sd of [-1, 1]) {
        parts.push(box(0.1, 0.1, 0.1, sd * 0.4, 1.28, 0, K), box(0.1, 0.1, 0.1, sd * 0.14, 0.56, 0.0, K), box(0.15, 0.14, 0.05, sd * 0.13, 0.56, 0.16, A));   // elbow and knee joints, knee guard
        if (h) parts.push(box(0.12, 0.3, 0.12, sd * 0.43, 1.25, 0.0, A), box(0.17, 0.34, 0.06, sd * 0.13, 0.82, 0.14, A), box(0.1, 0.12, 0.3, sd * 0.1, 1.82, -0.02, D));   // forearm and thigh plates, helmet fins
    }
    if (h) parts.push(box(0.04, 0.16, 0.3, 0, 1.97, -0.02, A));   // crest
    const geo = tagLights(mergeGeometries(parts, false)!); geo.computeBoundingSphere(); return geo;
}
export function shadowMat(time: { value: number }, rate: number, pedestrian = false) {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, blending: THREE.NormalBlending, emissive: new THREE.Color('#1c2230'), emissiveIntensity: 0.5 });
    const gaitMasks = pedestrian
        ? `float armRegion = smoothstep(0.26, 0.34, ax) * (1.0 - smoothstep(1.66, 1.74, y));
           float wl = (1.0 - smoothstep(0.92, 1.02, y)) * (1.0 - armRegion);
           float wa = smoothstep(0.26, 0.34, ax) * smoothstep(0.76, 0.90, y) * (1.0 - smoothstep(1.66, 1.74, y));`
        : `float wl = 1.0 - smoothstep(0.92, 1.02, y);
           float wa = smoothstep(0.26, 0.34, ax) * smoothstep(0.9, 1.0, y) * (1.0 - smoothstep(1.66, 1.74, y));`;
    m.onBeforeCompile = (sh) => {
        occludeFade(sh);
        sh.uniforms.uT = time; sh.uniforms.uRate = { value: rate };
        sh.vertexShader = 'uniform float uT,uRate;\nvec3 rotX(vec3 p,vec3 c,float a){float s=sin(a),k=cos(a);vec3 d=p-c;return c+vec3(d.x,d.y*k-d.z*s,d.y*s+d.z*k);}\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        { float ph = uT * uRate + instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.51, sd = transformed.x < 0.0 ? -1.0 : 1.0, y = transformed.y, ax = abs(transformed.x);
          ${gaitMasks}
          transformed = mix(transformed, rotX(transformed, vec3(0.0, 1.0, 0.0), sin(ph) * 0.5 * sd), wl);
          transformed = mix(transformed, rotX(transformed, vec3(sd * 0.31, 1.55, 0.0), -sin(ph) * 0.45 * sd), wa);
          transformed.y += abs(sin(ph)) * 0.035; }`);
    };
    m.customProgramCacheKey = () => pedestrian ? 'shadowbot-pedestrian-hands' : 'shadowbot'; return m;
}

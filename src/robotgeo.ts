import { occludeFade } from './occlude';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROBOTS } from './robots';
// Robot population geometry: Polyfork free models (service-robot-93f82e, companion-bot-170074, survey-drone-7c71f9, service-drone-bot-3817e5)
// baked to compact flat-shaded vertex data, then recoloured and extended with plain armour boxes for this game. Licence: https://polyfork.dev/licensing
const B = (x: number, y: number, z: number, tx: number, ty: number, tz: number) => { const g = new THREE.BoxGeometry(x, y, z); g.translate(tx, ty, tz); return g; };
export type RGB = [number, number, number];
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const EYE_BLUE: RGB = [0.18, 0.55, 3.0], EYE_RED: RGB = [3.0, 0.14, 0.14];
// Semantic light tag for the screen-space outline pass: emissive (HDR, any channel > 1.5) vertices get alpha 0.5, everything else 1.
// The material draws with NoBlending, so the 0.5 reaches the frame buffer untouched and the outline shader skips those pixels.
export function tagLights(g: THREE.BufferGeometry) {
    const c = g.attributes.color; if (!c || c.itemSize === 4) return g;
    const n = c.count, a = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const r = c.getX(i), gg = c.getY(i), b = c.getZ(i); a[i * 4] = r; a[i * 4 + 1] = gg; a[i * 4 + 2] = b; a[i * 4 + 3] = Math.max(r, gg, b) > 1.5 ? 0.5 : 1; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 4)); return g;
}
const isEye = (c: number[]) => c[2] > c[0] + 60 && c[1] > c[0] + 60;   // the models' cyan sensor visors
export interface Extra { g: THREE.BufferGeometry; col: RGB; part: number; }
export interface RobotOpts { model: 'robot' | 'companion' | 'survey' | 'sdrone'; eye: RGB; shell?: RGB; frame?: RGB; accent?: RGB; dark?: RGB; scale: number; extras?: (scale: number) => Extra[]; }
export function robotGeo(o: RobotOpts) {
    const d = ROBOTS[o.model], n = d.n as number, pal = ROBOTS.pal as number[][];
    const q = new Int16Array(b64(d.pos).buffer), ci = b64(d.col), pt = b64(d.part);
    const pos: number[] = [], col: number[] = [], part: number[] = [];
    for (let i = 0; i < n; i++) {
        pos.push(q[i * 3] / 2000 * o.scale, q[i * 3 + 1] / 2000 * o.scale, q[i * 3 + 2] / 2000 * o.scale);
        const c = pal[ci[i]]; let r: RGB = [c[0] / 255, c[1] / 255, c[2] / 255];
        if (o.model === 'sdrone' && (isEye(c) || Math.max(c[0], c[1], c[2]) < 30)) r = o.shell || [0.91, 0.93, 0.96];   // crowd drone: flatten the moulded glass/frame into the shell, the visor bar is added below
        else if (isEye(c)) r = o.eye;
        else if (o.shell && c[0] > 150 && c[1] > 150) r = o.shell;                       // off-white shell plates
        else if (o.frame && Math.abs(c[0] - c[1]) < 12 && c[0] < 110) r = o.frame;      // gunmetal frame
        else if (o.dark && Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) > 45) r = o.dark;                   // saturated colours become armour plate
        else if (o.accent && c[0] > c[2] + 40 && c[0] > c[1] + 20) r = o.accent;         // orange accent
        col.push(r[0], r[1], r[2]); part.push(pt[i]);
    }
    const face = (p: number[], t: number) => Math.max(p[t * 3 + 1], p[(t + 1) * 3 + 1], p[(t + 2) * 3 + 1]) > 0.185;   // keep only the base skirt, the helmet is rebuilt below
    if (o.model === 'sdrone') {   // crowd drone: drop the side arm nubs so the helmet is one continuous shell, then cover the lower-face slot with a plate
        const kp: number[] = [], kc: number[] = [], kq: number[] = [];
        for (let t = 0; t < n; t += 3) { if (part[t] === 1 || part[t] === 2) continue; if (face(pos, t)) continue; for (let v = 0; v < 3; v++) { kp.push(pos[(t + v) * 3], pos[(t + v) * 3 + 1], pos[(t + v) * 3 + 2]); kc.push(col[(t + v) * 3], col[(t + v) * 3 + 1], col[(t + v) * 3 + 2]); kq.push(part[t + v]); } }
        pos.length = 0; col.length = 0; part.length = 0; pos.push(...kp); col.push(...kc); part.push(...kq);
    }
    const gs: THREE.BufferGeometry[] = [];
    const base = new THREE.BufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); base.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); base.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
    gs.push(base);
    const ex = o.extras ? o.extras(o.scale) : [];
    if (o.model === 'companion') { const k = o.scale; ex.push({ g: B(0.34 * k, 0.21 * k, 0.04 * k, 0, 0.805 * k, 0.44 * k), col: o.dark ? [0.10, 0.10, 0.12] : [0.84, 0.85, 0.87], part: 0 }, { g: B(0.26 * k, 0.07 * k, 0.04 * k, 0, 0.815 * k, 0.465 * k), col: o.eye, part: 0 }); }   // sensor visor over the porthole
    if (o.model === 'sdrone') {   // crowd drone helmet rebuilt as one smooth shell with a single visor band: no slot, ridges, brow or mouth
        const k = o.scale, pc: RGB = o.shell || [0.91, 0.93, 0.96];
        const prof = [[0.30, 0.09], [0.305, 0.18], [0.30, 0.30], [0.285, 0.42], [0.25, 0.54], [0.18, 0.62], [0.08, 0.66], [0.0, 0.67]].map(([r, y]) => new THREE.Vector2(r * k, y * k));
        const dome = new THREE.LatheGeometry(prof, 32); const f2 = new THREE.CylinderGeometry(0.303 * k, 0.303 * k, 0.085 * k, 24, 1, true, -0.85, 1.7); f2.translate(0, 0.37 * k, 0);
        ex.push({ g: dome, col: pc, part: 0 }, { g: f2, col: o.eye, part: 0 });
    }
    for (const e of ex) {
        const g = e.g.index ? e.g.toNonIndexed() : e.g; g.deleteAttribute('uv'); const m = g.attributes.position.count, c: number[] = [], p: number[] = [];
        for (let i = 0; i < m; i++) { c.push(...e.col); p.push(e.part); }
        g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); g.setAttribute('aPart', new THREE.Float32BufferAttribute(p, 1)); g.deleteAttribute('normal'); gs.push(g);
    }
    const g = mergeGeometries(gs, false)!; g.computeVertexNormals(); tagLights(g);
    return { geo: g, parts: d.parts as { m: number; piv?: number[]; s?: number }[], scale: o.scale };
}
// one animated Lambert material per geometry: legs/arms swing about their baked pivots, rotors spin (all on the GPU, no per-frame JS per robot)
export function robotMat(parts: { m: number; piv?: number[]; s?: number }[], scale: number, time: { value: number }, speed: number) {
    const piv = Array.from({ length: 8 }, (_, i) => { const p = parts[i]; return p && p.piv ? new THREE.Vector4(p.piv[0] * scale, p.piv[1] * scale, p.piv[2] * scale, p.m) : new THREE.Vector4(0, 0, 0, 0); });
    const sgn = Array.from({ length: 8 }, (_, i) => (parts[i] && parts[i].s) || 0);
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, blending: THREE.NormalBlending });
    m.onBeforeCompile = (sh) => {
        occludeFade(sh);
        sh.uniforms.uRT = time; sh.uniforms.uPiv = { value: piv }; sh.uniforms.uSgn = { value: sgn }; sh.uniforms.uSpd = { value: speed };
        sh.vertexShader = 'attribute float aPart;uniform float uRT;uniform vec4 uPiv[8];uniform float uSgn[8];uniform float uSpd;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    int pi=int(aPart+.5);
    if(pi>0){vec4 pv=uPiv[pi];float md=pv.w;float ph=uRT*uSpd+instanceMatrix[3].x*.37+instanceMatrix[3].z*.31;vec3 d=transformed-pv.xyz;
      if(md<1.5){float a=sin(ph)*.6*uSgn[pi];float c=cos(a),s=sin(a);transformed=pv.xyz+vec3(d.x,d.y*c-d.z*s,d.y*s+d.z*c);}
      else if(md<2.5){float a=sin(ph)*.5*uSgn[pi];float c=cos(a),s=sin(a);transformed=pv.xyz+vec3(d.x,d.y*c-d.z*s,d.y*s+d.z*c);}
      else {float a=uRT*38.*uSgn[pi]+float(pi);float c=cos(a),s=sin(a);transformed=pv.xyz+vec3(d.x*c+d.z*s,d.y,-d.x*s+d.z*c);}}`);
    };
    return m;
}
// Heavy armour for the enemy robots: pauldrons, chest plate, shin and forearm guards, back pack. Static plates ride the torso; guards ride the limbs.
export const armorRobot = (s: number): Extra[] => {
    const plate: RGB = [0.10, 0.10, 0.12], trim: RGB = [0.55, 0.06, 0.06], out: Extra[] = [];
    out.push({ g: B(0.48 * s, 0.34 * s, 0.30 * s, 0, 1.30 * s, 0.02 * s), col: plate, part: 0 }, { g: B(0.20 * s, 0.05 * s, 0.32 * s, 0, 1.20 * s, 0.02 * s), col: trim, part: 0 }, { g: B(0.40 * s, 0.50 * s, 0.14 * s, 0, 1.28 * s, -0.20 * s), col: plate, part: 0 }, { g: B(0.40 * s, 0.10 * s, 0.16 * s, 0, 1.56 * s, -0.20 * s), col: trim, part: 0 });
    for (const sd of [1, -1]) {
        out.push({ g: B(0.26 * s, 0.14 * s, 0.30 * s, sd * 0.30 * s, 1.50 * s, 0), col: plate, part: 0 }, { g: B(0.28 * s, 0.04 * s, 0.32 * s, sd * 0.30 * s, 1.58 * s, 0), col: trim, part: 0 });
        out.push({ g: B(0.14 * s, 0.30 * s, 0.17 * s, sd * 0.30 * s, 1.02 * s, 0.04 * s), col: plate, part: sd > 0 ? 3 : 4 });
        out.push({ g: B(0.17 * s, 0.30 * s, 0.22 * s, sd * 0.11 * s, 0.30 * s, 0.03 * s), col: plate, part: sd > 0 ? 1 : 2 });
        out.push({ g: B(0.20 * s, 0.14 * s, 0.24 * s, sd * 0.11 * s, 0.72 * s, 0.02 * s), col: plate, part: sd > 0 ? 1 : 2 });
    }
    return out;
};
export const armorCompanion = (s: number): Extra[] => { const g = new THREE.CylinderGeometry(0.50 * s, 0.53 * s, 0.10 * s, 14, 1, true); g.translate(0, 0.44 * s, 0); const g2 = new THREE.CylinderGeometry(0.30 * s, 0.38 * s, 0.07 * s, 14, 1, true); g2.translate(0, 0.96 * s, 0); return [{ g, col: [0.55, 0.06, 0.06], part: 0 }, { g: g2, col: [0.55, 0.06, 0.06], part: 0 }]; };
export const armorDrone = (s: number): Extra[] => [{ g: B(0.50 * s, 0.07 * s, 0.50 * s, 0, 0.32 * s, 0), col: [0.10, 0.10, 0.12], part: 0 }];
// pedestrian covering: a tabard/coat so the figure reads as a fully covered robot, not a bare frame
export const coatRobot = (col: RGB) => (s: number): Extra[] => {
    const out: Extra[] = [], g = new THREE.CylinderGeometry(0.26 * s, 0.33 * s, 0.62 * s, 10, 1, true); g.scale(1, 1, 0.78); g.translate(0, 1.0 * s, 0); out.push({ g, col, part: 0 });
    out.push({ g: B(0.42 * s, 0.34 * s, 0.26 * s, 0, 1.28 * s, 0.01 * s), col, part: 0 });
    return out;
};

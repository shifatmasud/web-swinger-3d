import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { QK } from '../quality';

// Tree and palm geometry: trunks, limbs, broadleaf/conifer/cherry crowns, palm fronds + their canvas textures, and the shared tree palette/pattern.
// env-iter3 natural trunks (Shifat Oct 29: "tree trunks look unnatural, fix; foliages are perfect"). One tube per trunk instead of a
// straight open cylinder: power-curve taper, a gentle seeded bend, a root flare with 5 buttress lobes fading up the first metre,
// slight bark irregularity, darker root-end vertex colour; the bark texture doubles as a bump map. Seeded by its OWN generator, so the
// leaf/canopy generator's random stream (and therefore every canopy) is exactly what it was.
type TubeOpt = { H: number; rBot: number; rTop: number; hSeg: number; rSeg: number; flare: number; lobes: number; bend: number; seed: number; path?: (t: number) => THREE.Vector3; radius?: (t: number) => number; vScale?: number };
function trunkTube(o: TubeOpt) {
    let r = o.seed * 7 + 13; const tr = () => (r = (r * 48271) % 2147483647) / 2147483647;
    const ph = tr() * 6.28, ph2 = tr() * 6.28, bx = (tr() - 0.5) * 2 * o.bend, bz = (tr() - 0.5) * 2 * o.bend;
    const path = o.path || ((t: number) => new THREE.Vector3(bx * Math.sin(Math.PI * t * 0.9) + bz * 0.3 * Math.sin(Math.PI * t * 1.7), o.H * t, bz * Math.sin(Math.PI * t * 0.8)));
    const rad = o.radius || ((t: number) => o.rTop + (o.rBot - o.rTop) * Math.pow(1 - t, 1.5));
    const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
    const T = new THREE.Vector3(), S1 = new THREE.Vector3(), S2 = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i <= o.hSeg; i++) {
        const t = Math.pow(i / o.hSeg, 1.5), c = path(t); T.copy(path(Math.min(1, t + 0.01))).sub(path(Math.max(0, t - 0.01))).normalize();
        S1.crossVectors(Z, T).normalize(); S2.crossVectors(T, S1).normalize();
        const hm = o.H * t, fl = Math.exp(-hm / 0.7), base = rad(t) * (1 + o.flare * fl);
        const tint = 0.8 + 0.2 * Math.min(1, hm / 1.4), tv = 1 + (tr() - 0.5) * 0.08;
        for (let j = 0; j <= o.rSeg; j++) {
            const a = (j / o.rSeg) * Math.PI * 2;
            const rr = base * (1 + o.lobes * fl * Math.sin(5 * a + ph) + 0.045 * Math.sin(3 * a + ph2 + hm * 0.9) + 0.03 * Math.sin(7 * a + hm * 2.3));
            const p = c.clone().addScaledVector(S1, Math.cos(a) * rr).addScaledVector(S2, Math.sin(a) * rr);
            pos.push(p.x, p.y, p.z); uv.push(j / o.rSeg, o.vScale ? hm / o.vScale : t);
            const k = tint * tv; col.push(k, k * 0.98, k * 0.95);
            if (i < o.hSeg && j < o.rSeg) { const a0 = i * (o.rSeg + 1) + j, a1 = a0 + o.rSeg + 1; idx.push(a0, a1, a0 + 1, a0 + 1, a1, a1 + 1); }
        }
    }
    // Shifat Oct 29 "weird tree trunk gape": the tube was open at the top, so the fork showed a hollow ring. Close it with a
    // low rounded cap (apex just above the last ring, along the trunk direction).
    { const top = o.hSeg * (o.rSeg + 1), cTop = path(1), Tt = path(1).sub(path(0.98)).normalize(), apex = pos.length / 3;
      const cap = cTop.addScaledVector(Tt, rad(1) * 0.6); pos.push(cap.x, cap.y, cap.z); uv.push(0.5, o.vScale ? (o.H + rad(1) * 0.6) / o.vScale : 1); col.push(0.82, 0.8, 0.78);
      for (let j = 0; j < o.rSeg; j++) idx.push(top + j, apex, top + j + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
    g.computeVertexNormals();
    { const n = g.attributes.normal as THREE.BufferAttribute, w = o.rSeg + 1; for (let i = 0; i <= o.hSeg; i++) { const a = i * w, b = a + o.rSeg; const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1; n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l); } }   // close the seam
    return { geo: g, at: (t: number) => path(t) };
}
/** Branch limb: tapered, 3 segments, curving up into the canopy, thicker collar where it leaves the trunk. Built along +Y. */
function limbGeo(rTop: number, rBot: number, len: number, rSeg: number) {
    const g = new THREE.CylinderGeometry(rTop, rBot, len, rSeg, 3, false); g.translate(0, len / 2, 0);   // closed ends (no hollow limb tips)
    const pa = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) { const y = pa.getY(i), t = y / len, col = 1 + 0.35 * Math.max(0, 1 - t / 0.18); pa.setXYZ(i, pa.getX(i) * col + len * 0.16 * t * t, y, pa.getZ(i) * col); }
    g.computeVertexNormals();
    const c = new Float32Array(pa.count * 3).fill(1); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
}
const withColor = (g: THREE.BufferGeometry, k = 1) => { if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(k), 3)); return g; };

// forest park: leafy trees. Reference study: Poly Haven CC0 scanned trees (island_tree_01 leaf atlas, jacaranda bark) - AAA-style alpha-cut leaf cards on a branching trunk; geometry here is my own, low card count for weak devices
const LEAF_BOX = [[14,18,151,526],[166,18,348,404],[708,18,838,426],[367,30,497,373],[527,48,667,374],[219,588,366,1024],[430,615,578,1024],[15,642,189,1024]];
type TreeSpec = { kind: 'broad' | 'umbrella' | 'poplar' | 'pine' | 'spruce' | 'cherry' | 'palm'; seed: number };
const PINE_BOX = [[30, 40, 230, 460]];
// broadleaf families share the scanned leaf atlas; each has its own trunk/branch structure and crown shape
export function treeGeo(kind: 'broad' | 'umbrella' | 'poplar' | 'cherry', seed: number, leafN: number, scaleMul = 1) {
    let r = seed; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    const trunkP: THREE.BufferGeometry[] = [], leafP: THREE.BufferGeometry[] = [];
    const shape = { broad: { H: 7.5, R: 4.4, sx: 1, sy: 0.85, sz: 1, nb: 6, cyk: 0.35, ls: 1 }, umbrella: { H: 5.2, R: 5.2, sx: 1.5, sy: 0.32, sz: 1.5, nb: 7, cyk: 0.2, ls: 0.62 }, poplar: { H: 5.5, R: 6.2, sx: 0.34, sy: 1, sz: 0.34, nb: 4, cyk: 0.55, ls: 0.8 }, cherry: { H: 3.9, R: 5.4, sx: 1.3, sy: 0.62, sz: 1.3, nb: 8, cyk: 0.28, ls: 0.46 } }[kind];
    const H = shape.H * (0.9 + rnd() * 0.25), R = shape.R * (0.9 + rnd() * 0.2);
    const tube = trunkTube({ H, rTop: kind === 'poplar' ? 0.22 : kind === 'broad' ? 0.42 : 0.28, rBot: kind === 'poplar' ? 0.4 : kind === 'broad' ? 0.78 : kind === 'cherry' ? 0.42 : 0.5, hSeg: 7, rSeg: 10, flare: kind === 'cherry' ? 0.45 : 0.38, lobes: 0.2, bend: kind === 'cherry' ? 0.3 : 0.2, seed }); trunkP.push(tube.geo);   // env-iter1: oak gets a thick flared trunk; env-iter3: natural tube
    const cy = H + R * shape.cyk * (kind === 'poplar' ? 0.7 : 1); const ctr: THREE.Vector3[] = [];
    for (let i = 0; i < shape.nb; i++) { const ang = rnd() * 6.28; const len = R * (0.7 + rnd() * 0.4) * (kind === 'poplar' ? 0.25 : 1); const bg = limbGeo(kind === 'broad' ? 0.08 : 0.05, kind === 'broad' ? 0.26 : 0.16, len, 5); bg.rotateZ(kind === 'umbrella' || kind === 'cherry' ? 0.95 + rnd() * 0.35 : 0.7 + rnd() * 0.5); bg.rotateY(ang); const hb = H * (0.55 + rnd() * 0.3), ba = tube.at(hb / H); bg.translate(ba.x, hb, ba.z); trunkP.push(bg); ctr.push(new THREE.Vector3(Math.cos(ang) * R * 0.55 * shape.sx, cy + (rnd() - 0.4) * R * 0.5 * shape.sy, Math.sin(ang) * R * 0.55 * shape.sz)); }
    ctr.push(new THREE.Vector3(0, cy + R * 0.3 * shape.sy, 0));
    // Shifat Oct 29 "foliage must make that trunk top not visible": two extra leaf clusters wrapped around the trunk's top and fork,
    // so the crown closes over where the trunk ends instead of floating above it.
    { const tt = tube.at(1); ctr.push(new THREE.Vector3(tt.x, H + R * 0.08, tt.z), new THREE.Vector3(tt.x, H - R * 0.12, tt.z)); }
    for (let i = 0; i < leafN; i++) {
        const c = ctr[Math.floor(rnd() * ctr.length)]; const bx = LEAF_BOX[Math.floor(rnd() * 8)];
        const u = new THREE.Vector3(rnd() - 0.5, (rnd() - 0.5) * 0.8, rnd() - 0.5).normalize().multiplyScalar(R * 0.48 * Math.cbrt(rnd())); u.x *= shape.sx; u.y *= shape.sy; u.z *= shape.sz;
        const w = (bx[2] - bx[0]) / 1024, h = (bx[3] - bx[1]) / 1024, sc = 4.0 * scaleMul * shape.ls * (0.7 + rnd() * 0.6);
        const g = new THREE.PlaneGeometry(w * sc, h * sc); g.translate(0, h * sc / 2, 0);
        const uv = g.attributes.uv; for (let k = 0; k < 4; k++) uv.setXY(k, bx[0] / 1024 + uv.getX(k) * w, 1 - bx[3] / 1024 + uv.getY(k) * h);
        const e = new THREE.Euler((rnd() - 0.5) * 2.2 + 0.5, rnd() * 6.28, (rnd() - 0.5) * 1.2);
        g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(e)); g.translate(c.x + u.x, c.y + u.y, c.z + u.z);
        const col = new Float32Array(12), shade = 0.8 + 0.3 * ((u.y / R + 0.6)); for (let k = 0; k < 4; k++) { col[k * 3] = shade; col[k * 3 + 1] = shade; col[k * 3 + 2] = shade * (0.90 + 0.08 * Math.sin(i * 1.7)); } g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        leafP.push(g);
    }
    return { trunk: mergeGeometries(trunkP, false)!, leaves: mergeGeometries(leafP, false)! };
}
// conifers: whorled branches carrying scanned pine needle sprays (Poly Haven pine_tree_01 twig). pine = tall bare trunk, open crown; spruce = full conical, drooping branches
const _q = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0);
export function coniferGeo(kind: 'pine' | 'spruce', seed: number, bpw: number, cpb: number, cardMul: number) {
    let r = seed; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    const trunkP: THREE.BufferGeometry[] = [], leafP: THREE.BufferGeometry[] = [];
    const pine = kind === 'pine'; const H = (pine ? 12 : 10.5) * (0.9 + rnd() * 0.2), W = pine ? 9 : 14;
    const tube = trunkTube({ H, rTop: pine ? 0.1 : 0.08, rBot: pine ? 0.42 : 0.4, hSeg: 8, rSeg: 8, flare: 0.42, lobes: 0.18, bend: pine ? 0.22 : 0.08, seed }); trunkP.push(tube.geo);   // env-iter3: natural tube (was a straight 7-sided cylinder)
    const bx = PINE_BOX[0], w = (bx[2] - bx[0]) / 1024, h = (bx[3] - bx[1]) / 1024;
    const card = (pos: THREE.Vector3, dir: THREE.Vector3, len: number, shade: number) => {
        for (let pl = 0; pl < 2; pl++) {
            const g = new THREE.PlaneGeometry(len * (w / h) * 1.15, len); g.translate(0, len * 0.5, 0);
            const uv = g.attributes.uv; for (let k = 0; k < 4; k++) uv.setXY(k, bx[0] / 1024 + uv.getX(k) * w, 1 - bx[3] / 1024 + uv.getY(k) * h);
            _q.setFromUnitVectors(_Y, dir); const roll = rnd() * 6.28 + pl * 1.5708;
            g.applyMatrix4(new THREE.Matrix4().makeRotationY(roll)); g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(_q)); g.translate(pos.x, pos.y, pos.z);
            const col = new Float32Array(12); for (let k = 0; k < 4; k++) { col[k * 3] = shade; col[k * 3 + 1] = shade; col[k * 3 + 2] = shade; } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); leafP.push(g);
        }
    };
    for (let i = 0; i < W; i++) {
        const f = i / (W - 1), y = pine ? H * (0.5 + 0.48 * f) : H * (0.12 + 0.86 * f);
        const Lb = pine ? 3.4 * (1 - 0.55 * f) + 0.5 : 4.2 * (1 - f) + 0.5;
        const el = pine ? -0.05 + 0.45 * f : -0.4 + 0.3 * f; const off = rnd() * 6.28;
        for (let b = 0; b < bpw; b++) {
            const ang = off + (b / bpw) * 6.28 + (rnd() - 0.5) * 0.5; const dir = new THREE.Vector3(Math.cos(ang), el + (rnd() - 0.5) * 0.2, Math.sin(ang)).normalize();
            const L = Lb * (0.8 + rnd() * 0.4);
            if (pine) { const bg = withColor(new THREE.CylinderGeometry(0.03, 0.09, L, 4, 1, true)); bg.translate(0, L / 2, 0); _q.setFromUnitVectors(_Y, dir); bg.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(_q)); bg.translate(0, y, 0); trunkP.push(bg); }
            for (let c = 0; c < cpb; c++) {
                const t = 0.3 + 0.7 * (c + 1) / cpb; const p = new THREE.Vector3(0, y, 0).addScaledVector(dir, L * t);
                const cd = dir.clone(); cd.y += pine ? 0.25 : 0.1 - 0.5 * t; cd.x += (rnd() - 0.5) * 0.5; cd.z += (rnd() - 0.5) * 0.5; cd.normalize();
                card(p, cd, (pine ? 2.6 : 2.1) * cardMul * (0.8 + rnd() * 0.4), (pine ? 0.9 : 0.62) + 0.3 * f);
            }
        }
    }
    for (let k = 0; k < 3; k++) card(new THREE.Vector3(0, H * 0.96, 0), new THREE.Vector3((rnd() - 0.5) * 0.3, 1, (rnd() - 0.5) * 0.3).normalize(), 2.0 * cardMul, 0.95);
    return { trunk: mergeGeometries(trunkP, false)!, leaves: mergeGeometries(leafP, false)! };
}

// env-iter1 palm (coconut palm refs: Wikimedia Cocos nucifera photos cited in the report): curved ringed trunk from flared
// segments, a crown boot, three coconuts. env-iter3 fronds (Shifat Oct 29 "palm fronds look basic"): each frond is one arched,
// drooping strip folded into a shallow inverted V along its rib (left edge, rib, right edge x 9 segments = 36 tris), textured with
// a procedural pinnate leaflet alpha map (central rib + ~60 thin leaflet pairs) and alpha-tested, never alpha-blended. 18 living
// fronds in a golden-angle spiral (upper ones rise, lower ones droop), 4 browning hangers and 2 young spears: ~860 tris per palm
// (the old solid fronds were 720), 240 tris on the far LOD. Refs: Cocos nucifera crown photos (Wikimedia Commons) for the
// V-fold, leaflet angle and the ring of dead hanging fronds.
const PALM_TEX_W = 256, PALM_TEX_H = 512;
let _palmFrondTex: THREE.Texture | null = null, _palmTrunkTex: THREE.Texture | null = null;
export function palmFrondTex() {
    if (_palmFrondTex) return _palmFrondTex;
    const W = PALM_TEX_W, H = PALM_TEX_H, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d')!; let r = 4242; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    const Y = (v: number) => (1 - v) * H;   // v = 0 at the frond base (canvas bottom), 1 at the tip
    const N = 62;
    for (const s of [-1, 1]) for (let k = 0; k < N; k++) {
        const v0 = 0.1 + 0.87 * (k + rnd() * 0.6) / N, tip = Math.min(1, v0 + 0.06 + 0.03 * rnd());
        const reach = (0.86 + 0.13 * rnd()) * (W * 0.5 - 4);
        const x0 = W / 2 + s * 2, y0 = Y(v0), x2 = W / 2 + s * reach, y2 = Y(tip), x1 = W / 2 + s * reach * 0.45, y1 = Y(v0 + (tip - v0) * 0.85);
        const wb = 4.4 - 1.6 * v0, steps = 10, L: number[][] = [], R: number[][] = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
            const px = a * x0 + b * x1 + c * x2, py = a * y0 + b * y1 + c * y2;
            const dx = 2 * (1 - t) * (x1 - x0) + 2 * t * (x2 - x1), dy = 2 * (1 - t) * (y1 - y0) + 2 * t * (y2 - y1), dl = Math.hypot(dx, dy) || 1;
            const hw = 0.5 * wb * (1 - 0.85 * t) * (t < 0.15 ? 0.6 + t * 2.7 : 1);
            L.push([px - dy / dl * hw, py + dx / dl * hw]); R.push([px + dy / dl * hw, py - dx / dl * hw]);
        }
        const h = 80 + rnd() * 16, sat = 46 + rnd() * 14, li = 33 + rnd() * 8 + v0 * 7;
        const gr = g.createLinearGradient(x0, y0, x2, y2); gr.addColorStop(0, `hsl(${h},${sat}%,${li}%)`); gr.addColorStop(1, `hsl(${h - 14},${sat + 6}%,${li + 13}%)`);
        g.fillStyle = gr; g.beginPath(); g.moveTo(L[0][0], L[0][1]); for (const p of L) g.lineTo(p[0], p[1]); for (let i = R.length - 1; i >= 0; i--) g.lineTo(R[i][0], R[i][1]); g.closePath(); g.fill();
    }
    for (let i = 0; i < 40; i++) {   // the rib: a pale tapering midrib drawn over the leaflet roots
        const v0 = i / 40, v1 = (i + 1) / 40, w = 7 - 5.2 * v0;
        g.fillStyle = `rgb(${178 - 30 * v0},${170 - 18 * v0},${92 - 10 * v0})`; g.fillRect(W / 2 - w / 2, Y(v1), w, Y(v0) - Y(v1) + 1);
    }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = QK.anisotropy; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return (_palmFrondTex = t);
}
export function palmTrunkTex() {
    if (_palmTrunkTex) return _palmTrunkTex;
    const W = 64, H = 256, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d')!;
    let r = 977; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    g.fillStyle = 'rgb(226,216,200)'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(${90 + rnd() * 40},${80 + rnd() * 30},${64 + rnd() * 20},0.16)`; g.fillRect(rnd() * W, 0, 1 + rnd() * 2, H); }   // vertical fibre
    const n = 14;
    for (let k = 0; k < n; k++) {   // leaf-scar rings: dark groove with a lit lip above it, slightly wavy
        const y = (k + 0.5) * H / n;
        for (let x = 0; x < W; x += 2) { const w = Math.sin(x / W * 6.283 * 2 + k) * 1.4; g.fillStyle = 'rgba(120,102,84,0.55)'; g.fillRect(x, y + w, 2, 2.2); g.fillStyle = 'rgba(245,238,226,0.6)'; g.fillRect(x, y + w - 1.2, 2, 1.2); }
    }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = QK.anisotropy; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return (_palmTrunkTex = t);
}
type Frond = { ang: number; up: number; L: number; droop: number; W: number; fold: number; ph: number; c: number[] };
function palmFrondStrips(top: THREE.Vector3, fronds: Frond[], n: number) {
    const pos: number[] = [], col: number[] = [], uv: number[] = [], fr: number[] = [], idx: number[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (const f of fronds) {
        const dir = new THREE.Vector3(Math.cos(f.ang), 0, Math.sin(f.ang)), side = new THREE.Vector3(-dir.z, 0, dir.x);
        const rib = (t: number) => top.clone().addScaledVector(dir, 0.12 + f.L * t * Math.cos(f.up) * (1 - 0.12 * t)).addScaledVector(up, f.L * (Math.sin(f.up) * t - f.droop * t * t));
        const b = pos.length / 3;
        for (let i = 0; i <= n; i++) {
            const t = i / n, p = rib(t), w = f.W * (0.1 + 0.9 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + t * 1.0)), 0.55)) * (t < 0.1 ? t * 7 + 0.3 : 1);
            const fold = f.fold * (0.55 + 0.75 * t), cw = Math.cos(fold) * w, sw = Math.sin(fold) * w;
            const sh = 0.72 + 0.28 * t, cc = [f.c[0] * sh, f.c[1] * sh, f.c[2] * sh];
            for (const s of [-1, 0, 1]) {
                const q = p.clone().addScaledVector(side, s * cw).addScaledVector(up, -Math.abs(s) * sw);
                pos.push(q.x, q.y, q.z); col.push(...(s === 0 ? cc.map((x) => x * 1.05) : cc)); uv.push(0.5 + s * 0.5, t); fr.push(t, f.ph);
            }
            if (i < n) { const a = b + i * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setAttribute('aFr', new THREE.Float32BufferAttribute(fr, 2)); geo.setIndex(idx);
    geo.computeVertexNormals();
    { const na = geo.attributes.normal as THREE.BufferAttribute; for (let i = 0; i < na.count; i++) na.setY(i, Math.abs(na.getY(i)) + 0.6); }   // fronds read lit from above on both faces
    return geo;
}
export function palmGeo(seed: number) {
    let r = seed; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    const trunkP: THREE.BufferGeometry[] = [];
    const H = 7.2 + rnd() * 1.4, lean = 0.9 + rnd() * 0.7;
    const at = (t: number) => new THREE.Vector3(lean * t * t * 1.15, H * t, 0.25 * Math.sin(t * 3.0));
    // env-iter3 trunk: one smooth curved tube (was 11 stacked flared cylinders with a sawtooth silhouette), swollen bulb at the
    // foot, gentle taper to the crown; the leaf-scar rings come from the ring texture (also its bump map).
    trunkP.push(trunkTube({ H, rTop: 0.17, rBot: 0.27, hSeg: 14, rSeg: 8, flare: 0.55, lobes: 0.1, bend: 0, seed, path: at, radius: (t) => (0.27 - 0.1 * t + 0.02 * Math.sin(t * 9.0)) * (1 - 0.35 * Math.max(0, (t - 0.8) / 0.2) ** 1.5), vScale: 2.2 }).geo);
    const top = at(1);
    const plain = (g: THREE.BufferGeometry, k: number) => { const uv = g.attributes.uv as THREE.BufferAttribute; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.98); return withColor(g, k); };   // coconuts + crown boot: plain, no ring stripes
    for (let k = 0; k < 3; k++) { const c = new THREE.SphereGeometry(0.17, 6, 4); const a = k * 2.1 + 0.4; c.translate(top.x + Math.cos(a) * 0.22, top.y - 0.25, top.z + Math.sin(a) * 0.22); trunkP.push(plain(c, 0.85)); }
    { const c = new THREE.CylinderGeometry(0.0, 0.12, 1.1, 7, 3, true); c.translate(top.x + lean * 0.08, top.y + 0.5, top.z); trunkP.push(plain(c, 0.78)); }   // Shifat Oct 29: the trunk's top narrows to a pointed tip (the spear the fronds grow from), not a blunt end
    // frond layout (golden-angle spiral; seeded so hi and lo LOD share it)
    const live: Frond[] = [], dead: Frond[] = [], spear: Frond[] = [];
    for (let f = 0; f < 18; f++) {
        const tier = f / 17;   // 0 = top of the crown, 1 = lowest living frond
        live.push({ ang: f * 2.39996 + rnd() * 0.25, up: 0.95 - 1.05 * tier + (rnd() - 0.5) * 0.18, L: 3.7 + rnd() * 1.1 - 0.4 * (1 - tier), droop: 0.55 + 0.5 * tier + rnd() * 0.15, W: 0.62 + rnd() * 0.12, fold: 0.42 + rnd() * 0.18, ph: rnd(), c: [0.92 + rnd() * 0.08, 0.95 + rnd() * 0.05, 0.85] });
    }
    for (let f = 0; f < 4; f++) dead.push({ ang: f * 1.571 + 0.6 + rnd() * 0.5, up: -0.75 - rnd() * 0.3, L: 2.6 + rnd() * 0.6, droop: 0.15, W: 0.42, fold: 0.95, ph: rnd(), c: [1.05, 0.7, 0.36] });
    for (let f = 0; f < 2; f++) spear.push({ ang: f * 3.1 + rnd(), up: 1.35, L: 1.7 + rnd() * 0.4, droop: 0.1, W: 0.18, fold: 1.1, ph: rnd(), c: [0.95, 1.0, 0.72] });
    const leaves = palmFrondStrips(top, [...live, ...dead, ...spear], 9);
    const lo = palmFrondStrips(top, live.filter((_, i) => i % 3 !== 2), 5);
    const trunk = mergeGeometries(trunkP, false)!;
    return { trunk, leaves, lo };
}
// Cherry blossom recolour: same scanned leaf-card silhouettes, texel luminance remapped to a sakura pink ramp (refs: Wikimedia
// Prunus serrulata 'Kanzan' / Yoshino cherry photos cited in the report).
export const cherryLeafShader = (sh: any) => {
    leafWindShader(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `vec4 sdc = texture2D(map, vMapUv); float lmc = dot(sdc.rgb, vec3(0.3, 0.59, 0.11));
    diffuseColor.rgb *= mix(vec3(0.62, 0.20, 0.33), vec3(1.0, 0.70, 0.82), smoothstep(0.02, 0.32, lmc)); diffuseColor.a *= sdc.a;`);
};
// Palm fronds: shared tree wind + a slow per-frond bob that grows toward the tip (aFr = [t along frond, frond phase]); the
// alpha boost keeps thin leaflets from dissolving in smaller mips under alphaTest (coverage-preserving trick, Ben Golus 2017).
export const palmFrondShader = (sh: any) => {
    leafWindShader(sh);
    sh.vertexShader = 'attribute vec2 aFr;\n' + sh.vertexShader.replace('float flutter =', 'float flutter = 1.8 *').replace('transformed.z += windBend * 0.38;', `transformed.z += windBend * 0.38;
    float frs = sin(uTreeWindTime * 1.35 + windPhase * 2.0 + aFr.y * 6.283) * 0.6 + sin(uTreeWindTime * 2.3 + aFr.y * 17.0) * 0.25;
    transformed.y += frs * 0.16 * aFr.x * aFr.x; transformed.x += frs * 0.05 * aFr.x;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', `{ vec2 tsz = vMapUv * vec2(${PALM_TEX_W}.0, ${PALM_TEX_H}.0); vec2 ddx = dFdx(tsz), ddy = dFdy(tsz); float plod = 0.5 * log2(max(max(dot(ddx, ddx), dot(ddy, ddy)), 1e-6)); diffuseColor.a *= 1.0 + max(plod, 0.0) * 0.3; }
#include <alphatest_fragment>`);
};
// env-iter1: four species — 0 oak, 1/5 pine, 2 spruce (pine family, conical), 3 cherry blossom, 4 palm.
export const TREE_TYPES: { kind: TreeSpec['kind']; seed: number }[] = [{ kind: 'broad', seed: 11 }, { kind: 'pine', seed: 31 }, { kind: 'spruce', seed: 57 }, { kind: 'cherry', seed: 77 }, { kind: 'palm', seed: 1234 }, { kind: 'pine', seed: 99 }];
export const TREE_PATTERN = [0, 1, 2, 0, 5, 2, 1, 0, 2, 5, 0, 1, 2, 0, 3, 5, 1, 2, 0, 2];


// Wind reference: GPU Gems3 ch6, shared low-frequency bend plus smaller leaf motion.
// Root stays fixed; world-position phase spreads gusts without CPU instance updates.
export const treeWindTime = { value: 0 };
const treeWind = (leaf: boolean) => (sh: any) => {
    sh.uniforms.uTreeWindTime = treeWindTime;
    sh.vertexShader = 'uniform float uTreeWindTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    #ifdef USE_BATCHING
    vec2 windRoot = batchingMatrix[3].xz;
    #else
    vec2 windRoot = instanceMatrix[3].xz;
    #endif
    float windPhase = windRoot.x * 0.035 + windRoot.y * 0.027;
    float windHeight = max(position.y, 0.0);
    float windBend = windHeight * windHeight * (sin(uTreeWindTime * 0.75 + windPhase) * 0.0024 + sin(uTreeWindTime * 1.17 + windPhase * 1.7) * 0.0009);
    transformed.x += windBend;
    transformed.z += windBend * 0.38;
    ${leaf ? 'float flutter = sin(uTreeWindTime * 3.2 + dot(position, vec3(1.9,2.3,1.4)) + windPhase) * min(windHeight, 1.0) * 0.024; transformed.x += flutter; transformed.z += flutter * 0.55;' : ''}
    `);
};
export const trunkWindShader = treeWind(false), leafWindShader = treeWind(true);

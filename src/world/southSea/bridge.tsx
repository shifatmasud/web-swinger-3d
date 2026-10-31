import { BRIDGE, BRIDGE_L, CABLE_X, bridgeDeckU, cableY, towerZ } from '../../seaWorld';
import * as THREE from 'three';
import { PHONE, colorize, hazeShader, merged, type SouthSeaKit } from './common';
import { type Sim } from '../../sim';
import { useMemo } from 'react';
import { SELECTIVE_BLOOM_LAYER } from '../../renderLayers';
import { useFrame } from '@react-three/fiber';

// The east bridge from the city to Neon Harbor: deck, towers + struts, cables and lamp heads.
// ---------------------------------------------------------------- STEP 3: the bridge
const ORANGE = '#c4462e';
function quad(pos: number[], col: number[], a: number[], b: number[], c: number[], d: number[], cc: THREE.Color) { pos.push(...a, ...b, ...c, ...a, ...c, ...d); for (let i = 0; i < 6; i++) col.push(cc.r, cc.g, cc.b); }
function bridgeDeckGeo() {
    const pos: number[] = [], col: number[] = [], hw = BRIDGE.hw, step = 5, n = Math.ceil(BRIDGE_L / step);
    const prof: [number, number, string][] = [[-hw - 0.3, -1.9, ORANGE], [-hw - 0.3, 0.15, '#b9b4aa'], [-hw + 1.4, 0.15, '#9a958c'], [-hw + 1.4, 0.0, '#3b3f47'], [hw - 1.4, 0.0, '#9a958c'], [hw - 1.4, 0.15, '#b9b4aa'], [hw + 0.3, 0.15, ORANGE], [hw + 0.3, -1.9, '#5a3a32']];
    const cc = new THREE.Color();
    for (let i = 0; i < n; i++) {
        const u0 = i * step, u1 = Math.min(BRIDGE_L, (i + 1) * step), z0 = BRIDGE.z0 - u0, z1 = BRIDGE.z0 - u1, y0 = bridgeDeckU(u0), y1 = bridgeDeckU(u1);
        for (let k = 0; k < prof.length; k++) {
            const A = prof[k], B = prof[(k + 1) % prof.length]; cc.set(A[2]);
            quad(pos, col, [BRIDGE.x + A[0], y0 + A[1], z0], [BRIDGE.x + B[0], y0 + B[1], z0], [BRIDGE.x + B[0], y1 + B[1], z1], [BRIDGE.x + A[0], y1 + A[1], z1], cc);
        }
        if (i % 2 === 0) { cc.set('#f2d24a'); for (const lx of [-0.12, 0.12]) quad(pos, col, [BRIDGE.x + lx - 0.08, y0 + 0.03, z0], [BRIDGE.x + lx + 0.08, y0 + 0.03, z0], [BRIDGE.x + lx + 0.08, y1 + 0.03, z1], [BRIDGE.x + lx - 0.08, y1 + 0.03, z1], cc); }   // centre line
        cc.set(ORANGE);
        for (const sx of [-1, 1]) { const x = BRIDGE.x + sx * (hw + 0.25); quad(pos, col, [x, y0 + 0.15, z0], [x, y0 + 1.15, z0], [x, y1 + 1.15, z1], [x, y1 + 0.15, z1], cc); quad(pos, col, [x, y1 + 0.15, z1], [x, y1 + 1.15, z1], [x, y0 + 1.15, z0], [x, y0 + 0.15, z0], cc); }   // railings (both faces)
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
}
function bridgeStructGeo() {
    const parts: THREE.BufferGeometry[] = [], H = BRIDGE.towerH, floor = -32;
    for (let i = 0; i < 3; i++) {
        const z = towerZ(i), dy = bridgeDeckU(BRIDGE.towerU[i]);
        for (const sx of [-1, 1]) { const g = new THREE.BoxGeometry(BRIDGE.legW, H - floor, BRIDGE.legW * 1.3); g.translate(BRIDGE.x + sx * BRIDGE.legX, (H + floor) / 2, z); parts.push(colorize(g, ORANGE)); }
        for (const y of [dy - 2.6, 44, 70, H - 3]) { const g = new THREE.BoxGeometry(BRIDGE.legX * 2 + BRIDGE.legW, y === dy - 2.6 ? 1.6 : 3.2, BRIDGE.legW * 1.1); g.translate(BRIDGE.x, y, z); parts.push(colorize(g, ORANGE)); }
        { const g = new THREE.BoxGeometry(BRIDGE.legX * 2 + 9, 34, 12); g.translate(BRIDGE.x, floor + 17 + 1.0, z); parts.push(colorize(g, '#9c968c')); }   // concrete pier through the waterline
        for (const sx of [-1, 1]) { const g = new THREE.BoxGeometry(BRIDGE.legW + 0.8, 1.2, BRIDGE.legW * 1.6); g.translate(BRIDGE.x + sx * BRIDGE.legX, H + 0.6, z); parts.push(colorize(g, '#8f3322')); }   // saddles
    }
    for (let u = 40; u < BRIDGE_L - 20; u += 45) {   // approach piers where the deck is low
        if (u > 150 && u < BRIDGE_L - 150) continue;
        const y = bridgeDeckU(u) - 1.9; for (const sx of [-1, 1]) { const g = new THREE.BoxGeometry(2.4, y - floor, 2.4); g.translate(BRIDGE.x + sx * 3.8, (y + floor) / 2, BRIDGE.z0 - u); parts.push(colorize(g, '#a49e94')); }
    }
    const hstep = PHONE ? 14 : 10;
    for (let u = 60; u < BRIDGE_L - 60; u += hstep) { const yd = bridgeDeckU(u) + 0.2, yc = cableY(u); if (yc - yd < 2.5) continue; for (const sx of [-1, 1]) { const g = new THREE.BoxGeometry(0.14, yc - yd, 0.14); g.translate(BRIDGE.x + sx * CABLE_X, (yc + yd) / 2, BRIDGE.z0 - u); parts.push(colorize(g, '#d0583c')); } }
    for (let u = 15; u < BRIDGE_L; u += 30) { const y = bridgeDeckU(u), sx = (Math.round(u / 30) % 2) ? 1 : -1; const g = new THREE.CylinderGeometry(0.09, 0.12, 6, 5); g.translate(BRIDGE.x + sx * (BRIDGE.hw - 0.5), y + 3, BRIDGE.z0 - u); parts.push(colorize(g, '#5d6168')); }   // lamp posts
    return merged(parts);
}
function cableGeo() {
    const out: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) { const pts: THREE.Vector3[] = []; for (let u = 0; u <= BRIDGE_L; u += 6) pts.push(new THREE.Vector3(BRIDGE.x + sx * CABLE_X, cableY(u), BRIDGE.z0 - u)); const t = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.5, PHONE ? 4 : 6, false); out.push(colorize(t, '#b8432c')); }
    return merged(out);
}
function lampHeadGeo() { const parts: THREE.BufferGeometry[] = []; for (let u = 15; u < BRIDGE_L; u += 30) { const y = bridgeDeckU(u), sx = (Math.round(u / 30) % 2) ? 1 : -1; const g = new THREE.SphereGeometry(0.35, 6, 4); g.translate(BRIDGE.x + sx * (BRIDGE.hw - 0.5), y + 6.1, BRIDGE.z0 - u); parts.push(g); } return merged(parts); }
// (3b) the bridge's traffic is the game's flying cars (sim CARS axis 2), drawn by FlyingCars with the city ones
export function Bridge({ sim, kit }: { sim: Sim; kit: SouthSeaKit }) {
    const body = useMemo(() => merged([bridgeDeckGeo(), bridgeStructGeo(), cableGeo()]), []), heads = useMemo(lampHeadGeo, []);   // 25 fps pass: deck + structure + cables share one material -> one draw call
    const mat = useMemo(() => { const m = new THREE.MeshLambertMaterial({ vertexColors: true }); m.onBeforeCompile = hazeShader(kit.tod); return m; }, []);
    const lampMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffe7a8' }), []);
    useFrame(() => { const night = 1 - kit.tod.day.value; lampMat.color.setRGB(1, 0.91, 0.66).multiplyScalar(0.35 + 0.9 * night); });
    return <group name="south-sea-bridge">
        <mesh geometry={body} material={mat} frustumCulled={false} />
        <mesh geometry={heads} material={lampMat} onUpdate={(o2) => o2.layers.enable(SELECTIVE_BLOOM_LAYER)} frustumCulled={false} />
    </group>;
}


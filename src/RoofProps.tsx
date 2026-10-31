import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { buildings, isLegacyCityCore } from './sim';

/* Upgrade #3 (Oct 29, 9:12 PM plan "rooftops are flat empty slabs"): rooftop clutter on every outer-city building —
   AC units with fan grilles, vent stacks, roof hatches and an occasional water tank on legs. Five instanced meshes for the
   whole city (5 draw calls), Lambert materials, no textures, so it is cheap on the Adreno 506 phone. Props sit near the roof
   edges and corners and keep the centre clear for landing; all are low (under 1.3 m) except tanks, which sit in a corner. */
type P = { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number };
const DBG = !!(import.meta as any).env.VITE_DBG;
function h01(a: number, b: number) { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); }

export function RoofProps({ harborOnly = false }: { harborOnly?: boolean }) {   /* the city copy lives inside CityGate (hidden from Neon Harbor), so the harbor gets its own copy outside it */
    const spotsRaw = useMemo(() => {
        const ac: P[] = [], fan: P[] = [], vent: P[] = [], hatch: P[] = [], tank: P[] = [], legs: P[] = [];
        const spots: { x: number; z: number; top: number; pcs: P[]; lists: P[][]; foot: number; core?: boolean }[] = [];
        let curCore = false; const spot = (x: number, z: number, top: number, foot: number, items: [P[], P][]) => Math.hypot(x - 4, z + 4) < 8 ? 0 : spots.push({ x, z, top, foot, core: curCore, pcs: items.map((i) => i[1]), lists: items.map((i) => i[0]) } as any);
        buildings.forEach((b: any, bi: number) => {
            const harbor = b.sea && b.kind === 'harbor' && b.h - b.y0 < 120;   /* 11:53 PM: Neon Harbor towers had bare roofs too (flat boxes, boss tower excluded) */
            if (b.host !== undefined || (b.sea && !harbor) || harbor !== harborOnly) return;
            const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, w = b.x1 - b.x0, d = b.z1 - b.z0;
            const core = isLegacyCityCore(cx, cz) || harbor;   // sweep 11:40 PM: the centre city (spawn roof!) was still bare slabs; its roofs are flat boxes, so no ray needed
            if (w < 9 || d < 9) return;
            if (core && Math.abs(cx - 40) < 3 && Math.abs(cz) < 3) return;   // boss arena roof stays clear
            if (cx >= -251 && cx <= -229 && cz >= 69 && cz <= 92) return;
            curCore = core;
            const y = b.h, r = (k: number) => h01(bi * 13.7 + k, cx * 0.13 + cz * 0.071 + k * 0.37);
            const edge = (k: number): [number, number] => {   // anywhere on the roof except a clear landing disc in the middle
                for (let t = 0; t < 6; t++) { const u = r(k + t * 7.1) - 0.5, v = r(k + t * 7.1 + 0.5) - 0.5; if (Math.hypot(u, v) > (core ? 0.28 : 0.2)) { const sx = core ? (w - 7) / w : 0.78, sz = core ? (d - 7) / d : 0.78; return [cx + u * w * sx, cz + v * d * sz]; } }
                return [cx + w * 0.3, cz + d * 0.3];
            };
            const nAc = 5 + Math.floor(r(1) * 4);
            for (let k = 0; k < nAc; k++) { const [x, z] = edge(10 + k), ry = r(20 + k) > 0.5 ? 0 : Math.PI / 2, s = 1.25 + r(30 + k) * 0.6;
                spot(x, z, y, 0.9 * s, [[ac, { x, y: y + 0.55 * s, z, sx: 1.6 * s, sy: 1.1 * s, sz: 1.2 * s, ry }], [fan, { x, y: y + 1.11 * s, z, sx: 0.85 * s, sy: 0.05, sz: 0.85 * s, ry }]]); }
            const nV = 3 + Math.floor(r(2) * 3);
            for (let k = 0; k < nV; k++) { const [x, z] = edge(40 + k), s = 1.1 + r(50 + k) * 0.7; spot(x, z, y, 0.5 * s, [[vent, { x, y: y + 0.6 * s, z, sx: s, sy: s, sz: s, ry: 0 }]]); }
            if (r(3) < 0.7) { const [x, z] = edge(60); spot(x, z, y, 0.9, [[hatch, { x, y: y + 0.45, z, sx: 1.8, sy: 0.9, sz: 1.4, ry: r(61) > 0.5 ? 0 : Math.PI / 2 }]]); }
            if (r(4) < 0.6 && w > 14 && d > 14) {   // water tank in one corner
                const qx = r(70) > 0.5 ? 1 : -1, qz = r(71) > 0.5 ? 1 : -1, x = cx + qx * (w * 0.5 - (core ? 6.5 : 4.2)), z = cz + qz * (d * 0.5 - (core ? 6.5 : 4.2));
                spot(x, z, y, 1.6, [[tank, { x, y: y + 3.6, z, sx: 1, sy: 1, sz: 1, ry: 0 }], ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([lx, lz]) => [legs, { x: x + lx * 1.3, y: y + 1.1, z: z + lz * 1.3, sx: 1, sy: 1, sz: 1, ry: 0 }] as [P[], P])]);
            }
        });
        if ((import.meta as any).env.VITE_DBG) (window as any).__roofs = buildings.filter((b: any) => b.host === undefined && !b.sea && !isLegacyCityCore((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2)).slice(0, 40).map((b: any) => [(b.x0 + b.x1) / 2, b.h, (b.z0 + b.z1) / 2, b.x1 - b.x0]);
        return { spots, ac, fan, vent, hatch, tank, legs };
    }, []);
    const scene = useThree((s) => s.scene);
    const [sets, setSets] = useState<Record<string, P[]> | null>(null);
    useEffect(() => {   // drop each prop onto the real model roof: ray down at the prop's footprint (centre + 4 corners); keep it only where the roof is flat
        let tries = 0, dead = false; const ray = new THREE.Raycaster(), dn = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3();
        const run = () => {
            if (dead) return; const grp = scene.getObjectByName('polyfork-city-buildings');
            const meshes: THREE.Object3D[] = []; grp?.traverse((c: any) => { if ((c.isInstancedMesh && c.count > 0) || c.isBatchedMesh) meshes.push(c); });
            if (meshes.length < 2 && tries++ < 40) { setTimeout(run, 500); return; }
            const out: Record<string, P[]> = { ac: [], fan: [], vent: [], hatch: [], tank: [], legs: [] }, names = new Map<P[], string>([[spotsRaw.ac, 'ac'], [spotsRaw.fan, 'fan'], [spotsRaw.vent, 'vent'], [spotsRaw.hatch, 'hatch'], [spotsRaw.tank, 'tank'], [spotsRaw.legs, 'legs']]);
            ray.far = 14;
            for (const sp of spotsRaw.spots) {
                if (sp.core) { sp.pcs.forEach((p, k) => out[names.get(sp.lists[k])!].push({ ...p })); continue; }
                const ys: number[] = [];
                for (const [dx, dz] of [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) { o.set(sp.x + dx * sp.foot, sp.top + 4, sp.z + dz * sp.foot); ray.set(o, dn); const h = ray.intersectObjects(meshes, false)[0]; if (!h || !h.face || h.face.normal.y < 0.85) { ys.length = 0; break; } ys.push(h.point.y); }
                if (ys.length < 5 || Math.max(...ys) - Math.min(...ys) > 0.25) continue;   // sloped, curved, edge or gap: no prop here
                const dy = ys[0] - sp.top;
                sp.pcs.forEach((p, k) => out[names.get(sp.lists[k])!].push({ ...p, y: p.y + dy }));
            }
            // water tanks are solid (land on them, bump into them); the small AC units and vents stay walk-through to keep the per-frame collision loops cheap on phones
            for (const t of out.tank) { const hb = buildings.findIndex((b: any) => b.host === undefined && !b.sea && t.x > b.x0 && t.x < b.x1 && t.z > b.z0 && t.z < b.z1);
                if (hb >= 0) (buildings as any[]).push({ x0: t.x - 2.0, x1: t.x + 2.0, z0: t.z - 2.0, z1: t.z + 2.0, h: t.y + 2.5, host: hb }); }
            if (DBG) (window as any).__roofTanks = out.tank.map((t) => [t.x, t.y, t.z]);
            if (DBG) (window as any)[harborOnly ? '__roofPropsH' : '__roofProps'] = { spots: spotsRaw.spots.length, placed: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])) };
            setSets(out);
        };
        const t = setTimeout(run, 800); return () => { dead = true; clearTimeout(t); };
    }, [scene]);
    const geos = useMemo(() => {
        const tankG = new THREE.CylinderGeometry(1.9, 1.9, 3.0, 12); const roof = new THREE.ConeGeometry(2.05, 1.0, 12); roof.translate(0, 2.0, 0);
        const merged = mergeTwo(tankG, roof);
        const vent = new THREE.CylinderGeometry(0.28, 0.28, 1.2, 8); const cap = new THREE.CylinderGeometry(0.5, 0.5, 0.12, 8); cap.translate(0, 0.62, 0);
        return { box: new THREE.BoxGeometry(1, 1, 1), fan: new THREE.CylinderGeometry(0.5, 0.5, 1, 10), vent: mergeTwo(vent, cap), tank: merged, leg: new THREE.BoxGeometry(0.22, 2.2, 0.22) };
    }, []);
    const mats = useMemo(() => ({
        ac: new THREE.MeshLambertMaterial({ color: '#c9ccd2' }), fan: new THREE.MeshLambertMaterial({ color: '#3c4048' }),
        vent: new THREE.MeshLambertMaterial({ color: '#8d939c' }), hatch: new THREE.MeshLambertMaterial({ color: '#6d5d58' }),
        tank: new THREE.MeshLambertMaterial({ color: '#a8735b' }), leg: new THREE.MeshLambertMaterial({ color: '#4a3c38' }),
    }), []);
    if (!sets) return null;
    return <group name="roof-props">
        <Inst list={sets.ac} geo={geos.box} mat={mats.ac} />
        <Inst list={sets.fan} geo={geos.fan} mat={mats.fan} />
        <Inst list={sets.vent} geo={geos.vent} mat={mats.vent} />
        <Inst list={sets.hatch} geo={geos.box} mat={mats.hatch} />
        <Inst list={sets.tank} geo={geos.tank} mat={mats.tank} />
        <Inst list={sets.legs} geo={geos.leg} mat={mats.leg} />
    </group>;
}
function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry) {
    const A = a.toNonIndexed(), B = b.toNonIndexed(), g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal']) { const x = A.getAttribute(k).array as Float32Array, y = B.getAttribute(k).array as Float32Array, o = new Float32Array(x.length + y.length); o.set(x); o.set(y, x.length); g.setAttribute(k, new THREE.BufferAttribute(o, 3)); }
    return g;
}
function Inst({ list, geo, mat }: { list: P[]; geo: THREE.BufferGeometry; mat: THREE.Material }) {
    const ref = useRef<THREE.InstancedMesh>(null!);
    useEffect(() => {
        if (!ref.current) return;   // empty list renders nothing
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
        list.forEach((it, i) => { e.set(0, it.ry, 0); q.setFromEuler(e); m.compose(p.set(it.x, it.y, it.z), q, s.set(it.sx, it.sy, it.sz)); ref.current.setMatrixAt(i, m); });
        ref.current.instanceMatrix.needsUpdate = true; ref.current.computeBoundingSphere();
    }, [list]);
    if (!list.length) return null;
    return <instancedMesh ref={ref} args={[geo, mat, list.length]} castShadow={false} receiveShadow={false} />;
}

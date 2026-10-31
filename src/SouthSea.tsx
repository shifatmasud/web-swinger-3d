// South Sea steps 2-4 renderer (Shifat Oct 29): the jungle island (bridge-free), later the bridge and Neon Harbor.
// Shapes and heights come from southsea.ts (the sim uses the same functions, so what you see is what you walk on).
import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Sim } from './sim';
import { ISLAND, LAGOON, POOLS, PEAK, FALLS, DOCK, SHACKS, LIGHTHOUSE, islandH, islandPeakY, coastK, islandRR, poolAt, RIVERS, riverNear, riverHW, POOL, FALL_WALL, riverY, RIVER_DEEP, BRIDGE, BRIDGE_L, bridgeDeckU, cableY, CABLE_X, towerZ, HARBOR, HBLOCKS, HBRIDGES, HTOWERS, HBOSS, HCOLS, HROWS, AVENUE } from './seaWorld';
import { buildings } from './sim';
import { QUALITY, QK, LOWQ } from './quality';
import { SELECTIVE_BLOOM_LAYER } from './renderLayers';
import { CAUSTIC_TEX, CAUSTIC_GLSL, HERO_REFL } from './caustics';
import { RIVER_MAT, fallsMat, FALLS_MATS, FOAM_MAT, poolWaterMat } from './water/islandWater';
import { type SouthSeaKit, PHONE, HAZE_K, SKY_BLUE, hazeShader, colorize, merged, rnd, setSeed } from './world/southSea/common';
import { NeonHarbor, LightShafts, CITY_LOD } from './world/southSea/neonHarbor';
import { coniferGeo } from './world/trees';
import { PINE_URL } from './texdata';
import { Bridge } from './world/southSea/bridge';
import { BEACH_T, GRASS_T, GRASS_U, MIST_MAT, SPRAY_MAT, beachShader, dockGeo, fallsSheet, islandTerrainGeo, lighthouseGeo, riverGeo, shacksGeo, sprayGeo, type Inst } from './world/southSea/islandGeo';
export { hazeShader, CITY_LOD };
export type { SouthSeaKit };

function Island({ sim, kit }: { sim: Sim; kit: SouthSeaKit }) {
    const terrain = useMemo(islandTerrainGeo, []);
    const terrainMat = useMemo(() => { const m = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#1d1b16' }); m.onBeforeCompile = hazeShader(kit.tod, beachShader); return m; }, []);
    useFrame((_, dt) => { BEACH_T.value += Math.min(dt, 0.1); });
    const lh = useMemo(lighthouseGeo, []), shacks = useMemo(shacksGeo, []), dock = useMemo(dockGeo, []);
    const sheets = useMemo(() => [fallsSheet(FALLS.w * 1.15, 0.0), fallsSheet(FALLS.w, 0.7), fallsSheet(FALLS.w * 0.8, 1.4)], []);
    const spray = useMemo(() => sprayGeo(PHONE ? 50 : 110, FALLS.w), []), mist = useMemo(() => sprayGeo(PHONE ? 14 : 30, FALLS.w * 1.6), []), river = useMemo(riverGeo, []);
    const foamPos = useMemo(() => [POOL.cx + (-FALLS.dx) * (FALL_WALL - 2.2), POOL.y + 0.06, POOL.cz + (-FALLS.dz) * (FALL_WALL - 2.2)] as [number, number, number], []);
    const propMat = useMemo(() => { const m = new THREE.MeshLambertMaterial({ vertexColors: true }); m.onBeforeCompile = hazeShader(kit.tod); return m; }, []);
    const lampMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#fff3c4' }), []);
    const waters = useMemo(() => POOLS.map((p) => { const g = new THREE.CircleGeometry(p.r * p.rim, 48); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, poolWaterMat(p)); m.position.set(p.cx, p.y, p.cz); m.renderOrder = 2; return m; }), []);
    // vegetation (2b: more variety): tall curved palms, short bushy palms, jungle broadleaves, tall thin canopy trees, ferns, bushes
    const veg = useMemo(() => {
        setSeed(9001);
        const out: Record<string, Inst[]> = { palmA: [], palmB: [], broad: [], tall: [], fern: [], bush: [], grass: [], rock: [], pine: [], spruce: [], cherry: [] };
        const all: Inst[] = [];
        const clear = (x: number, z: number, m = 1) => Math.hypot(x - PEAK.x, z - PEAK.z) > 7 * m && !poolAt(x, z) && Math.hypot(x - LAGOON.cx, z - LAGOON.cz) > LAGOON.r * 1.05 && Math.hypot(x - POOL.cx, z - POOL.cz) > POOL.r * 1.15 && Math.abs(x - DOCK.x) + Math.max(0, z - DOCK.z0) > 5 && !SHACKS.some((s) => Math.hypot(x - s.x, z - s.z) < 5 * m) && distToFalls(x, z) > 5 * m && (riverNear(x, z)?.d ?? 99) > (riverNear(x, z)?.hw ?? 0) * 1.5;
        const slopeAt = (x: number, z: number) => { const y = islandH(x, z) ?? 0; return Math.hypot((islandH(x + 1, z) ?? y) - y, (islandH(x, z + 1) ?? y) - y); };
        const put = (key: string, n: number, tries: number, pick: () => [number, number], ok: (y: number, x: number, z: number) => boolean, gap: number, sc: [number, number], sy?: [number, number], seaward = false) => {
            for (let k = 0; k < tries && out[key].length < n; k++) {
                const [x, z] = pick(), y = islandH(x, z) ?? -9;
                if (!ok(y, x, z) || !clear(x, z) || (gap > 0 && all.some((p) => Math.hypot(p.x - x, p.z - z) < gap))) continue;
                const it: Inst = { x, y: y - 0.2, z, s: sc[0] + rnd() * (sc[1] - sc[0]), r: seaward ? -Math.atan2(z - ISLAND.cz, x - ISLAND.cx) + (rnd() - 0.5) * 0.7 : rnd() * 6.28, sy: sy ? sy[0] + rnd() * (sy[1] - sy[0]) : undefined, tint: rnd() };
                out[key].push(it); if (gap > 0) all.push(it);
            }
        };
        const ring = (a0: number, a1: number): (() => [number, number]) => () => { const a = rnd() * Math.PI * 2, rr = (a0 + rnd() * (a1 - a0)) * coastK(a); return [ISLAND.cx + Math.cos(a) * ISLAND.R * rr, ISLAND.cz + Math.sin(a) * ISLAND.R * rr]; };   // relative to the organic coastline
        const disc = (r: number): (() => [number, number]) => () => { const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * r * coastK(a); return [ISLAND.cx + Math.cos(a) * ISLAND.R * rr, ISLAND.cz + Math.sin(a) * ISLAND.R * rr]; };
        const F = PHONE ? 0.65 : 1;
        put('palmA', Math.round(28 * F), 900, ring(0.62, 0.84), (y) => y > 1.2 && y < 4.5, 5.5, [1.0, 1.4], undefined, true);   // coconut palms lean out toward the sea
        put('palmB', Math.round(18 * F), 900, ring(0.55, 0.8), (y) => y > 1.4 && y < 7, 4.5, [0.95, 1.2], [0.5, 0.65], true);
        put('broad', Math.round(40 * F), 3000, disc(0.66), (y, x, z) => y > 3.2 && slopeAt(x, z) < 1.4, 7, [0.9, 1.4]);
        put('tall', Math.round(22 * F), 3000, disc(0.66), (y, x, z) => y > 4 && slopeAt(x, z) < 1.3, 6, [0.85, 1.25]);   // 2c: park broadleaf (second seed) instead of the custom umbrella tree
        put('bush', Math.round(70 * F), 3000, disc(0.74), (y) => y > 2.4, 2.2, [1.4, 2.4]);   // the park's shrub
        put('rock', 14, 900, ring(0.88, 1.0), (y) => y > -2.0 && y < 1.2, 8, [0.8, 1.9], [0.55, 0.85]);   // a few weathered boulders at the waterline
        // Shifat Oct 31 11:29 AM 'island must have tree variations, add pine & others': pines + spruces on the high ground, poplars on the mid slopes
        put('pine', Math.round(16 * F), 3000, disc(0.6), (y, x, z) => y > 4.5 && slopeAt(x, z) < 1.8, 6, [0.85, 1.25]);
        put('spruce', Math.round(10 * F), 3000, disc(0.6), (y, x, z) => y > 6 && slopeAt(x, z) < 1.8, 6, [0.8, 1.15]);
        put('cherry', Math.round(16 * F), 3000, disc(0.62), (y, x, z) => y > 3.2 && slopeAt(x, z) < 1.4, 7, [0.8, 1.1]);
        // long grass: a 1 m mask of where it may grow (height or NaN), so the hero-centred patch re-places with plain lookups
        const half = 110, n = 220, mask = new Float32Array(n * n).fill(NaN);
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = ISLAND.cx - half + i + 0.5, z = ISLAND.cz - half + j + 0.5, y = islandH(x, z); if (y === null || y < 2.7) continue; if (slopeAt(x, z) > 1.3 || !clear(x, z, 0.5)) continue; mask[j * n + i] = y; }
        (out as any).mask = { half, n, mask };
        return out;
    }, []);
    const geos = useMemo(() => {
        const pine = PHONE ? (() => { const h = coniferGeo('pine', 31, 3, 2, 1.6); return h; })() : coniferGeo('pine', 31, 5, 3, 1.12), spruce = PHONE ? coniferGeo('spruce', 17, 3, 2, 1.6) : coniferGeo('spruce', 17, 6, 3, 1.12), cherry = kit.treeGeo('poplar', 7, Math.round(340 * QK.foliage), 1.45);
        const pA = kit.palmGeo(97), pB = kit.palmGeo(41), t = kit.treeGeo('broad', 23, Math.round(260 * (PHONE ? 0.8 : 1)), 1.45), u = kit.treeGeo('broad', 11, Math.round(460 * QK.foliage), 1.45), b = { leaves: kit.parkBushGeo() };   // 2c: the city park's own broadleaf + shrub
        const rock = (() => { const g = new THREE.DodecahedronGeometry(1, 1).toNonIndexed(); const pa = g.attributes.position as THREE.BufferAttribute; let r = 31; const rn = () => (r = (r * 16807) % 2147483647) / 2147483647; const seen = new Map<string, number>(); for (let i = 0; i < pa.count; i++) { const k = pa.getX(i).toFixed(3) + pa.getY(i).toFixed(3) + pa.getZ(i).toFixed(3); if (!seen.has(k)) seen.set(k, 0.75 + rn() * 0.5); const f = seen.get(k)!; pa.setXYZ(i, pa.getX(i) * f, pa.getY(i) * f * 0.8, pa.getZ(i) * f); } g.computeVertexNormals(); return colorize(g, '#ffffff'); })();
        return { pA, pB, t, u, b, grass: kit.tuftGeo(), rock, pine, spruce, cherry };
    }, []);
    const tex = useMemo(() => { const l = new THREE.TextureLoader(); const mk = (u: string, rep = false) => { const t = l.load(u); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = QK.anisotropy; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 3); } return t; }; return { leaf: mk('/spray145.png'), bark: mk('/bark.jpg', true), bush: mk('/shrub134.png'), pine: mk(PINE_URL), pbark: mk('/pinebark.jpg', true) }; }, []);
    const mats = useMemo(() => ({
        palmTrunk: Object.assign(new THREE.MeshLambertMaterial({ map: kit.palmTrunkTex(), bumpMap: kit.palmTrunkTex(), bumpScale: 1.6, vertexColors: true, color: '#a89274', emissive: '#3a3024', side: THREE.DoubleSide }), { onBeforeCompile: hazeShader(kit.tod, kit.trunkWindShader) }),
        palmLeaf: Object.assign(new THREE.MeshLambertMaterial({ map: kit.palmFrondTex(), vertexColors: true, emissive: '#2a3a14', alphaTest: 0.5, side: THREE.DoubleSide }), { onBeforeCompile: hazeShader(kit.tod, kit.palmFrondShader) }),
        trunk: Object.assign(new THREE.MeshLambertMaterial({ map: tex.bark, bumpMap: tex.bark, bumpScale: 2.2, vertexColors: true, emissive: '#4a3a2c', side: THREE.DoubleSide }), { onBeforeCompile: hazeShader(kit.tod, kit.trunkWindShader) }),
        leaf: Object.assign(new THREE.MeshLambertMaterial({ map: tex.leaf, vertexColors: true, color: '#8fd06a', emissive: '#2e5a26', alphaTest: 0.5, side: THREE.DoubleSide }), { onBeforeCompile: hazeShader(kit.tod, kit.leafWindShader) }),
        leafDeep: Object.assign(new THREE.MeshLambertMaterial({ map: tex.leaf, vertexColors: true, color: '#5fae55', emissive: '#1f4a22', alphaTest: 0.5, side: THREE.DoubleSide }), { onBeforeCompile: hazeShader(kit.tod, kit.leafWindShader) }),
        bush: Object.assign(new THREE.MeshLambertMaterial({ map: tex.bush, color: '#dce1cd', emissive: '#182510', alphaTest: 0.5, side: THREE.DoubleSide }), { onBeforeCompile: hazeShader(kit.tod, kit.leafWindShader) }),
        grass: Object.assign(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: '#1c3410' }), { onBeforeCompile: kit.parkGrassOnCompile(GRASS_U) }),   // 2c: the park meadow's grass + its shader
        rock: Object.assign(new THREE.MeshLambertMaterial({ vertexColors: true, color: '#d4ccba', emissive: '#1a1814', flatShading: true }), { onBeforeCompile: hazeShader(kit.tod) }),
        pineTrunk: Object.assign(new THREE.MeshLambertMaterial({ map: tex.pbark, bumpMap: tex.pbark, bumpScale: 2.2, vertexColors: true, emissive: '#4a3a2c', side: THREE.DoubleSide }), { onBeforeCompile: hazeShader(kit.tod, kit.trunkWindShader), customProgramCacheKey: () => 'islPineTrunk' }),
        pineLeaf: Object.assign(new THREE.MeshLambertMaterial({ map: tex.pine, vertexColors: true, emissive: '#1f3a22', alphaTest: 0.5, side: THREE.DoubleSide }), { onBeforeCompile: hazeShader(kit.tod, kit.leafWindShader), customProgramCacheKey: () => 'islPineLeaf' }),
    }), []);
    /* 25 fps pass (Oct 31): island trees were 16 instanced draw calls (each species' trunk + leaves). Species sharing a material now go in ONE
       BatchedMesh per material (wind sway reads the batching matrix, per-tree tint kept as batch colour, per-tree frustum culling). */
    const vegSpecs = useMemo(() => [
        ['pAt', geos.pA.trunk, mats.palmTrunk, veg.palmA, '#ffffff', '#e8dccb'], ['pAl', PHONE ? geos.pA.lo : geos.pA.leaves, mats.palmLeaf, veg.palmA, '#ffffff', '#d8e8a8'],
        ['pBt', geos.pB.trunk, mats.palmTrunk, veg.palmB, '#f0e6d6', '#ffffff'], ['pBl', geos.pB.lo, mats.palmLeaf, veg.palmB, '#c8f0a0', '#ffffff'],
        ['bt', geos.t.trunk, mats.trunk, veg.broad, '#ffffff', '#d8cfc4'], ['bl', geos.t.leaves, mats.leaf, veg.broad, '#ffffff', '#b8e890'],
        ['ut', geos.u.trunk, mats.trunk, veg.tall, '#ffffff', '#e0d8d0'], ['ul', geos.u.leaves, mats.leaf, veg.tall, '#ffffff', '#c8e8a8'],
        ['pnt', geos.pine.trunk, mats.pineTrunk, veg.pine, '#ffffff', '#e0d8d0'], ['pnl', geos.pine.leaves, mats.pineLeaf, veg.pine, '#7fa898', '#6a9a84'],
        ['spt', geos.spruce.trunk, mats.pineTrunk, veg.spruce, '#ffffff', '#e0d8d0'], ['spl', geos.spruce.leaves, mats.pineLeaf, veg.spruce, '#5f8a62', '#6f9a70'],
        ['cht', geos.cherry.trunk, mats.trunk, veg.cherry, '#ffffff', '#e0d8d0'], ['chl', geos.cherry.leaves, mats.leafDeep, veg.cherry, '#e8f0c0', '#ffffff'],
    ] as [string, THREE.BufferGeometry, THREE.Material, Inst[], string, string][], []);
    const vegBatch = useMemo(() => {
        const byMat = new Map<THREE.Material, typeof vegSpecs>(), keys = new Set<string>(), meshes: THREE.BatchedMesh[] = [];
        const sig = (g: THREE.BufferGeometry) => Object.keys(g.attributes).sort().join(',') + (g.index ? '#i' : '#n');
        for (const s of vegSpecs) { if (!s[3].length) continue; const a = byMat.get(s[2]) ?? []; a.push(s); byMat.set(s[2], a); }
        const o = new THREE.Object3D(), c = new THREE.Color(), cb = new THREE.Color();
        for (const [mat, list0] of byMat) {
            const list = list0.filter((s) => sig(s[1]) === sig(list0[0][1]));
            if (list.length < 2) continue;
            let nv = 0, ni = 0, nInst = 0; for (const s of list) { nv += s[1].attributes.position.count; ni += s[1].index ? s[1].index.count : 0; nInst += s[3].length; }
            const bm = new THREE.BatchedMesh(nInst, nv, list[0][1].index ? ni : undefined, mat);
            bm.sortObjects = false; bm.perObjectFrustumCulled = true; bm.frustumCulled = false;
            for (const s of list) {
                const gid = bm.addGeometry(s[1]); keys.add(s[0]); cb.set(s[5]);
                for (const p of s[3]) { o.position.set(p.x, p.y, p.z); o.rotation.set(0, p.r, 0); o.scale.set(p.s, p.s * (p.sy ?? 1), p.s); o.updateMatrix(); const id = bm.addInstance(gid); bm.setMatrixAt(id, o.matrix); bm.setColorAt(id, c.set(s[4]).lerp(cb, p.tint ?? 0)); }
            }
            meshes.push(bm);
        }
        return { meshes, keys };
    }, [vegSpecs]);
    useEffect(() => () => { for (const m of vegBatch.meshes) m.dispose(); }, [vegBatch]);
    const vegRef = useRef<THREE.Group>(null!), nearRef = useRef<THREE.Group>(null!), grassRef = useRef<THREE.Group>(null!);
    const inst = useRef<Record<string, THREE.InstancedMesh | null>>({});
    useEffect(() => {
        const o = new THREE.Object3D(), c = new THREE.Color();
        const fill = (key: string, list: Inst[], tintA: string, tintB: string) => { const m = inst.current[key]; if (!m) return; list.forEach((p, i) => { o.position.set(p.x, p.y, p.z); o.rotation.set(0, p.r, 0); o.scale.set(p.s, p.s * (p.sy ?? 1), p.s); o.updateMatrix(); m.setMatrixAt(i, o.matrix); m.setColorAt(i, c.set(tintA).lerp(new THREE.Color(tintB), p.tint ?? 0)); }); m.count = list.length; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); };
        fill('pAt', veg.palmA, '#ffffff', '#e8dccb'); fill('pAl', veg.palmA, '#ffffff', '#d8e8a8');
        fill('pBt', veg.palmB, '#f0e6d6', '#ffffff'); fill('pBl', veg.palmB, '#c8f0a0', '#ffffff');
        fill('bt', veg.broad, '#ffffff', '#d8cfc4'); fill('bl', veg.broad, '#ffffff', '#b8e890');
        fill('ut', veg.tall, '#ffffff', '#e0d8d0'); fill('ul', veg.tall, '#ffffff', '#c8e8a8');
        fill('bush', veg.bush, '#e6f0d6', '#ffffff'); fill('rock', veg.rock, '#ffffff', '#b8b0a0');
        fill('pnt', veg.pine, '#ffffff', '#e0d8d0'); fill('pnl', veg.pine, '#7fa898', '#6a9a84'); fill('spt', veg.spruce, '#ffffff', '#e0d8d0'); fill('spl', veg.spruce, '#5f8a62', '#6f9a70');
        fill('cht', veg.cherry, '#ffffff', '#e0d8d0'); fill('chl', veg.cherry, '#e8f0c0', '#ffffff');
    }, []);
    const grassPool = useMemo(() => { setSeed(555); const N = PHONE ? 2600 : 6500, R0 = PHONE ? 34 : 44, a = new Float32Array(N * 5); for (let i = 0; i < N; i++) { const r = R0 * Math.sqrt(rnd()), t = rnd() * 6.283; a[i * 5] = Math.cos(t) * r; a[i * 5 + 1] = Math.sin(t) * r; a[i * 5 + 2] = rnd() * 6.283; a[i * 5 + 3] = 0.75 + rnd() * 0.7; a[i * 5 + 4] = rnd(); } return { N, a }; }, []);
    const grassAt = useRef([1e9, 1e9]);
    const placeGrass = (hx: number, hz: number) => {
        const m = inst.current['grass']; if (!m) return; const { half, n, mask } = (veg as any).mask, o = new THREE.Object3D(), c = new THREE.Color(), cA = new THREE.Color('#ffffff'), cB = new THREE.Color('#cfe38f'); let k = 0;
        for (let i = 0; i < grassPool.N; i++) {
            const q = grassPool.a, x = hx + q[i * 5], z = hz + q[i * 5 + 1], gi = Math.floor(x - ISLAND.cx + half), gj = Math.floor(z - ISLAND.cz + half);
            if (gi < 0 || gj < 0 || gi >= n || gj >= n) continue; const y = mask[gj * n + gi]; if (y !== y) continue;
            o.position.set(x, y - 0.05, z); o.rotation.set(0, q[i * 5 + 2], 0); o.scale.set(q[i * 5 + 3], q[i * 5 + 3] * (0.8 + q[i * 5 + 4] * 0.9), q[i * 5 + 3]); o.updateMatrix(); m.setMatrixAt(k, o.matrix); const cl = Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.09); m.setColorAt(k, c.setHSL(0.22 + q[i * 5 + 4] * 0.1 - 0.045 * cl + 0.03 * Math.sin(x * 0.045 + z * 0.06), 0.30 + 0.06 * cl, 0.34 + q[i * 5 + 4] * 0.10 + 0.065 * cl)); k++;   // the park meadow's tint formula
        }
        m.count = k; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    useFrame(({ camera }) => {
        const d = Math.hypot(camera.position.x - ISLAND.cx, camera.position.z - ISLAND.cz);
        if (d < 170 && Math.hypot(sim.pos[0] - grassAt.current[0], sim.pos[2] - grassAt.current[1]) > 6) { grassAt.current = [sim.pos[0], sim.pos[2]]; placeGrass(sim.pos[0], sim.pos[2]); }
        if (vegRef.current) vegRef.current.visible = d < (PHONE ? 330 : 430);
        if (nearRef.current) nearRef.current.visible = d < 260;
        if (grassRef.current) grassRef.current.visible = d < 170;
        const t = sim.t, day = kit.tod.day.value; GRASS_T.value = t; GRASS_U.uTime.value = t; GRASS_U.uHero.value.set(sim.pos[0], sim.pos[1], sim.pos[2]); GRASS_U.uCam.value.copy(camera.position);
        for (const m of FALLS_MATS) { m.uniforms.uT.value = t; m.uniforms.uDay.value = day; }
        FOAM_MAT.uniforms.uT.value = t; FOAM_MAT.uniforms.uDay.value = day; SPRAY_MAT.uniforms.uT.value = t; MIST_MAT.uniforms.uT.value = t;
        RIVER_MAT.uniforms.uT.value = t; RIVER_MAT.uniforms.uDay.value = day; (RIVER_MAT.uniforms.uSky.value as THREE.Color).copy(kit.tod.fog).lerp(SKY_BLUE, 0.45);
        for (const w of waters) { const u = (w.material as THREE.ShaderMaterial).uniforms; u.uT.value = t; u.uDay.value = day; u.uSky.value.copy(kit.tod.fog).lerp(SKY_BLUE, 0.45); u.uSun.value.copy(kit.tod.sun); }
        { const night = 1 - day; lampMat.color.setRGB(1, 0.95, 0.75).multiplyScalar(0.8 + 0.6 * night); }
    });
    const I = (key: string, geo: THREE.BufferGeometry, mat: THREE.Material, n: number) => <instancedMesh ref={(m) => { inst.current[key] = m; }} args={[geo, mat, Math.max(1, n)]} frustumCulled={false} />;
    return <group name="south-sea-island">
        <mesh geometry={terrain} material={terrainMat} frustumCulled={false} />
        <mesh geometry={lh.body} material={propMat} />
        <mesh geometry={lh.lamp} material={lampMat} onUpdate={(o) => o.layers.enable(SELECTIVE_BLOOM_LAYER)} />
        <LightShafts kit={kit} lampY={lh.lampY} />
        <mesh geometry={shacks} material={propMat} />
        <mesh geometry={dock} material={propMat} />
        <group ref={vegRef}>
            {vegBatch.meshes.map((m, i) => <primitive key={'vb' + i} object={m} />)}
            {vegSpecs.filter((s) => !vegBatch.keys.has(s[0])).map((s) => <React.Fragment key={s[0]}>{I(s[0], s[1], s[2], s[3].length)}</React.Fragment>)}
            {I('bush', geos.b.leaves, mats.bush, veg.bush.length)}
            {I('rock', geos.rock, mats.rock, veg.rock.length)}
        </group>
        <group ref={grassRef}><instancedMesh ref={(m) => { inst.current['grass'] = m; }} userData={{ outlineMaskAlpha: 0.5, outlineMaskThreshold: 0.75 }} args={[geos.grass, mats.grass, grassPool.N]} frustumCulled={false} /></group>
        <mesh geometry={river} material={RIVER_MAT} renderOrder={1} frustumCulled={false} />
        <group ref={nearRef}>
            {waters.map((w, i) => <primitive key={i} object={w} />)}
            {sheets.map((g, i) => <mesh key={i} geometry={g} material={FALLS_MATS[i]} renderOrder={3 + i} frustumCulled={false} />)}
            <mesh position={foamPos} rotation={[-Math.PI / 2, 0, 0]} material={FOAM_MAT} renderOrder={3} frustumCulled={false}><planeGeometry args={[FALLS.w * 1.9, FALLS.w * 1.9]} /></mesh>
            <points geometry={spray} material={SPRAY_MAT} renderOrder={6} frustumCulled={false} />
            <points geometry={mist} material={MIST_MAT} renderOrder={7} frustumCulled={false} />
        </group>
    </group>;
}
function distToFalls(x: number, z: number) {
    const ux = -FALLS.dx, uz = -FALLS.dz, rx = x - POOL.cx, rz = z - POOL.cz, along = rx * ux + rz * uz, perp = Math.abs(-rx * uz + rz * ux);
    return along > FALL_WALL - 4 && along < FALL_WALL + 6 ? Math.max(0, perp - FALLS.w * 0.6) : 99;
}

export function SouthSea({ sim, kit }: { sim: Sim; kit: SouthSeaKit }) {
    return <group name="south-sea"><Island sim={sim} kit={kit} /><Bridge sim={sim} kit={kit} /><NeonHarbor kit={kit} /></group>;
}
void islandPeakY; void HCOLS; void HROWS;

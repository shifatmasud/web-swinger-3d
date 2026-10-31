import tenementData from './polyfork-tenement.json';
import { PINE_URL, LEAVES_URL } from './texdata'
import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import gsap from 'gsap';
import heroData from './hero.json';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import baseTexUrl from './basetex';
import clipIdle from './clips/idle.json';
import clipJump from './clips/jump.json';
import clipWall from './clips/climbing_wall.json';
import clipPunch from './clips/punch.json';
import clipSwim from './clips/swimming.json';
import clipRun from './clips/run.json';
import { shadowGeo, shadowMat } from './shadowbot';
import { withPedestrianHands } from './pedestrianHands';
import { GiantBoss } from './GiantBoss';
import { BossArenaMarker } from './BossArenaMarker';
import { HBOSS } from './seaWorld';
import { BOSS_BODY_OFFSET } from './bossConfig';
import { attachInk, syncInk } from './ink';
import { robotGeo, robotMat, armorRobot, armorCompanion, armorDrone, coatRobot, EYE_BLUE, EYE_RED } from './robotgeo';
import { world, buildings, WATER_Z, CELL, PARK, PARK_POND, PARK_POND_Y, bridgeSurfaceAt, parkH, sandWeight, BEACH_DIR, LAKE_SHORE, WATER_Y, SEABED, SEA, seabedAt, BOATS, boatAt, BOAT_HX, BOAT_HZ, BOAT_DECK, BOAT_MAST, HALF, FOG, isLakeWater, lakeWaveH, waterSurfaceAt, stepSim, stepBeacon, resetSim, input, MOVES, SNARE, enemyBodyOffset, enemyPalm, ESHOT, CARS, CAR_N, CAR_SCALE, carAt, PED_VOICE, PILOT, type Unibeam, type Sim, type Events } from './sim';
import { ParkGround, PolyforkBuildings, PolyforkLakeBridge } from './polyforkEnvironment';
import { RoofProps } from './RoofProps';
import { StreetProps } from './StreetProps';
import { OCC } from './occlude';
import { QUALITY, QK, HQ, AA_FXAA, LOWQ } from './quality';
import { SelectiveBloomPass } from './SelectiveBloomPass';
import { SouthSea, CITY_LOD } from './SouthSea';
import { ISLAND, islandH } from './seaWorld'
import { CAUSTIC_TEX, CAUSTIC_GLSL, WATER_NRM, HERO_REFL } from './caustics';
import { TOD, UWF, UW } from './world/env';
import { seabedMat, wallMat, OCEAN_HALF, OCEAN_SNAP, oceanGeo, seabedGeo } from './water/seabed';
import { waterMat } from './water/oceanMaterial';
import { OceanFollow, IslandReflection, OceanScreenSpace } from './water/OceanPasses';
import { Boats, Gulls, Fish, MarineSnow, Whale } from './world/sealife';
import { buildEnemy, PlasmaFx, EnemyDeathFx, EnemyShotsFx } from './world/enemies';
import { DayNight } from './world/dayNight';
import { FarPropGate, CityGate } from './world/gates';
import { HERO_SC, BOT_SC } from './world/scale';
import { WindLines, Civilians } from './world/civilians';
import { FlyingCars } from './world/flyingCars';
import { Underwater } from './world/underwater';
import { waveAtWater, waterRenderY } from './water/waveHeight';
import { Forest, Meadow, parkBushGeo, parkGrassOnCompile, tuftGeo } from './world/forest';
import { treeGeo, coniferGeo, palmFrondTex, palmTrunkTex, palmGeo, cherryLeafShader, palmFrondShader, TREE_TYPES, TREE_PATTERN, treeWindTime, trunkWindShader, leafWindShader } from './world/trees';
import { FxaaPass, HeroHDPass, OutlinePass, OUTLINE_STATE } from './render/passes';
export { SHARPEN, FXAA_STATE, OUTLINE_STATE } from './render/passes';
import { City, TenementBlock, Sky } from './world/cityScenery';
import { waveSumJS } from './water/waves';
import { SKY_VS, SKY_FS } from './shaders/sky';
import { CITY_VS, CITY_FS } from './shaders/city';
import { FXAA_FS, FXAA_SHARP_FS, OUT_FS } from './shaders/post';
import { GLOW_VS, GLOW_FS } from './shaders/glow';
import { HD, applyRatio, worldBufferSize, worldTarget, registerHero, createHeroComposite } from './heroHD';
import { SELECTIVE_BLOOM_LAYER } from './renderLayers';



const DBG = !!(import.meta as any).env.VITE_DBG;   // test hooks only in instrumented builds

const tmp = new THREE.Object3D();

const SOUTH_SEA_KIT = { tod: TOD, palmGeo, treeGeo, tuftGeo, parkBushGeo, parkGrassOnCompile, palmTrunkTex, palmFrondTex, palmFrondShader, trunkWindShader, leafWindShader };   // South Sea island reuses the park's palm + broadleaf species
// ===== combat choreography poses (procedural layer on the existing rig; model untouched) =====
// Key poses read from real stills: Muybridge "Two men boxing" (1887) jab/cross shoulder turn + rear-heel pivot;
// Taekwondo 540 hook + capoeira armada (chamber, counter-lean, extended hook leg); Spider-Man 2 combat (launcher, air spike, web pull/yank).
type PoseK = Record<string, [number, number, number]>;
const CP_BONES = ['hips', 'spine', 'chest', 'head', 'uarmL', 'farmL', 'uarmR', 'farmR', 'thighL', 'shinL', 'thighR', 'shinR'];
const GUARD: PoseK = { hips: [0, 0.12, 0], spine: [0.12, 0, 0], chest: [0, 0.1, 0], head: [-0.08, -0.1, 0], uarmL: [-1.05, 0, 0.32], farmL: [-1.95, 0, 0], uarmR: [-0.85, 0, -0.38], farmR: [-2.05, 0, 0], thighL: [-0.38, 0, -0.06], shinL: [0.32, 0, 0], thighR: [0.28, 0, 0.06], shinR: [0.42, 0, 0] };
const P = (o: PoseK): PoseK => ({ ...GUARD, ...o });
const POSES: Record<number, [number, PoseK][]> = {
    1: [[0, GUARD], [0.33, P({ hips: [0, 0.28, 0], chest: [0, 0.42, 0], uarmL: [-1.55, 0, 0.14], farmL: [-0.08, 0, 0], head: [-0.05, -0.3, 0] })], [0.55, P({ hips: [0, 0.22, 0], chest: [0, 0.3, 0], uarmL: [-1.45, 0, 0.2], farmL: [-0.5, 0, 0] })], [1, GUARD]],
    2: [[0, P({ chest: [0, 0.3, 0] })], [0.34, P({ hips: [0, -0.38, 0], chest: [0, -0.62, 0], spine: [0.22, 0, 0], uarmR: [-1.58, 0, -0.12], farmR: [-0.06, 0, 0], uarmL: [-0.9, 0, 0.5], thighR: [0.12, 0, 0.04], shinR: [0.62, 0, 0], head: [-0.05, 0.35, 0] })], [0.6, P({ hips: [0, -0.3, 0], chest: [0, -0.45, 0], uarmR: [-1.4, 0, -0.2], farmR: [-0.6, 0, 0] })], [1, GUARD]],
    3: [[0, P({ hips: [0, 0.3, 0], chest: [0, 0.45, 0] })], [0.22, P({ spine: [-0.1, 0, 0], thighR: [-1.2, 0, 0.35], shinR: [1.7, 0, 0], thighL: [-0.1, 0, 0], shinL: [0.25, 0, 0] })], [0.5, P({ hips: [0, 0, -0.42], spine: [-0.32, 0, 0.2], chest: [0, 0, 0.15], thighR: [-0.45, 0, 1.45], shinR: [0.06, 0, 0], thighL: [0.05, 0, -0.05], shinL: [0.18, 0, 0], uarmL: [-0.4, 0, -1.0], farmL: [-0.6, 0, 0], uarmR: [-0.3, 0, 0.9], farmR: [-0.8, 0, 0] })], [0.72, P({ thighR: [-0.9, 0, 0.5], shinR: [1.2, 0, 0], spine: [-0.1, 0, 0] })], [1, GUARD]],
    4: [[0, P({ spine: [0.35, 0, 0], thighL: [-0.85, 0, 0], shinL: [1.3, 0, 0], thighR: [-0.25, 0, 0], shinR: [1.2, 0, 0], uarmR: [0.35, 0, 0.1], farmR: [-1.3, 0, 0] })], [0.38, P({ spine: [-0.28, 0, 0], chest: [0, -0.4, 0], uarmR: [-2.95, 0, -0.15], farmR: [-0.25, 0, 0], uarmL: [-0.4, 0, -0.6], farmL: [-1.2, 0, 0], thighL: [-1.6, 0, 0], shinL: [1.8, 0, 0], thighR: [0.2, 0, 0], shinR: [0.1, 0, 0], head: [-0.4, 0, 0] })], [0.7, P({ spine: [-0.15, 0, 0], uarmR: [-2.4, 0, -0.3], farmR: [-0.9, 0, 0], thighL: [-1.1, 0, 0], shinL: [1.6, 0, 0] })], [1, P({ thighL: [-0.6, 0, 0], shinL: [1.0, 0, 0], thighR: [-0.2, 0, 0], shinR: [0.8, 0, 0] })]],
    5: [[0, P({ thighL: [-1.4, 0, 0], shinL: [2.1, 0, 0], thighR: [-1.3, 0, 0], shinR: [2.0, 0, 0], spine: [0.35, 0, 0] })], [0.3, P({ hips: [0.25, 0, 0], thighR: [-1.9, 0, 0.1], shinR: [1.9, 0, 0], thighL: [-1.2, 0, 0], shinL: [2.0, 0, 0], uarmL: [-0.6, 0, -0.9], uarmR: [-0.6, 0, 0.9] })], [0.52, P({ hips: [0.55, 0, 0], spine: [0.2, 0, 0], thighR: [-1.25, 0, 0.05], shinR: [0.05, 0, 0], thighL: [-0.6, 0, 0], shinL: [1.9, 0, 0], uarmL: [-0.3, 0, -1.25], farmL: [-0.3, 0, 0], uarmR: [-0.2, 0, 1.25], farmR: [-0.3, 0, 0], head: [-0.4, 0, 0] })], [0.8, P({ hips: [0.2, 0, 0], thighR: [-0.9, 0, 0], shinR: [1.2, 0, 0], thighL: [-0.7, 0, 0], shinL: [1.4, 0, 0] })], [1, P({ thighL: [-0.5, 0, 0], shinL: [0.9, 0, 0], thighR: [-0.3, 0, 0], shinR: [0.7, 0, 0] })]],
    6: [[0, P({ uarmR: [-1.6, 0, -0.05], farmR: [-0.05, 0, 0], chest: [0, -0.35, 0] })], [0.22, P({ uarmR: [-1.55, 0, -0.1], farmR: [-0.1, 0, 0], uarmL: [-1.5, 0, 0.1], farmL: [-0.1, 0, 0], spine: [0.1, 0, 0] })], [0.4, P({ uarmR: [0.25, 0, 0.1], farmR: [-1.6, 0, 0], uarmL: [0.2, 0, -0.1], farmL: [-1.6, 0, 0], spine: [-0.2, 0, 0], thighR: [-1.3, 0, 0], shinR: [1.8, 0, 0] })], [0.55, P({ hips: [0.12, 0, 0], spine: [-0.18, 0, 0], thighR: [-1.6, 0, 0], shinR: [0.05, 0, 0], thighL: [0.6, 0, 0], shinL: [1.8, 0, 0], uarmR: [0.6, 0, 0.3], farmR: [-0.5, 0, 0], uarmL: [0.5, 0, -0.3], farmL: [-0.5, 0, 0] })], [0.8, P({ thighR: [-0.8, 0, 0], shinR: [1.0, 0, 0] })], [1, GUARD]],
    7: [[0, P({ uarmR: [-1.75, 0, -0.1], farmR: [-0.05, 0, 0], uarmL: [-1.7, 0, 0.1], farmL: [-0.05, 0, 0], spine: [0.15, 0, 0] })], [0.25, P({ uarmR: [-1.9, 0, -0.1], farmR: [-0.1, 0, 0], uarmL: [-1.85, 0, 0.1], farmL: [-0.1, 0, 0], spine: [0.1, 0, 0] })], [0.42, P({ uarmR: [0.45, 0, 0.15], farmR: [-1.4, 0, 0], uarmL: [0.45, 0, -0.15], farmL: [-1.4, 0, 0], spine: [-0.38, 0, 0], hips: [0, -0.2, 0], thighL: [-0.6, 0, 0], shinL: [0.6, 0, 0], thighR: [0.45, 0, 0], shinR: [0.4, 0, 0], head: [0.2, 0, 0] })], [0.75, P({ uarmR: [0.2, 0, 0.1], farmR: [-1.6, 0, 0], uarmL: [0.2, 0, -0.1], farmL: [-1.6, 0, 0], spine: [-0.15, 0, 0] })], [1, GUARD]],
};
export type CombatPoseState = { w: number; c: Float32Array; t: Float32Array };
export function createCombatPoseState(): CombatPoseState { return { w: 0, c: new Float32Array(CP_BONES.length * 3), t: new Float32Array(CP_BONES.length * 3) }; }
const _cp: CombatPoseState = createCombatPoseState();
const cstep = (x: number) => x * x * (3 - 2 * x);
function samplePose(keys: [number, PoseK][], u: number, out: Float32Array) {
    let k = 0; while (k < keys.length - 2 && u > keys[k + 1][0]) k++;
    const [u0, A] = keys[k], [u1, B] = keys[k + 1], f = cstep(Math.max(0, Math.min(1, (u - u0) / Math.max(1e-4, u1 - u0))));
    CP_BONES.forEach((n, i) => { const a = A[n], b = B[n]; for (let j = 0; j < 3; j++) out[i * 3 + j] = a[j] + (b[j] - a[j]) * f; });
}
export function combatPose(sim: any, rig: any, h: THREE.Object3D, dt: number, state: CombatPoseState = _cp) {
    const mv = sim.mv, fl = sim.flip, act = !!mv || !!fl;
    const bones = CP_BONES.map((n) => rig.b[n] as THREE.Bone);
    if (state.w < 0.02 && !act) { bones.forEach((b, i) => { state.c[i * 3] = b.rotation.x; state.c[i * 3 + 1] = b.rotation.y; state.c[i * 3 + 2] = b.rotation.z; }); state.w = 0; return; }
    state.w += ((act ? 1 : 0) - state.w) * Math.min(1, dt * (act ? 16 : 7));   // ease in fast, settle out slower: momentum, no snap
    if (mv) { const M = MOVES[mv.id]; samplePose(POSES[mv.id], Math.min(1, mv.t / M.dur), state.t); }
    else if (fl) { const u = fl.t / fl.dur, tuck = Math.sin(Math.min(1, u * 1.15) * Math.PI); samplePose([[0, GUARD], [1, P({ thighL: [-1.7, 0, 0], shinL: [2.2, 0, 0], thighR: [-1.6, 0, 0], shinR: [2.2, 0, 0], uarmL: [-1.2, 0, 0.6], farmL: [-1.8, 0, 0], uarmR: [-1.2, 0, -0.6], farmR: [-1.8, 0, 0], spine: [0.45, 0, 0] })]], fl.ax === 'x' ? tuck : tuck * 0.35, state.t);
        if (fl.ax === 'z') { const s0 = state.t; s0[4 * 3 + 2] = -1.5 * tuck; s0[6 * 3 + 2] = 1.5 * tuck; s0[8 * 3 + 2] = -0.5 * tuck; s0[10 * 3 + 2] = 0.5 * tuck; } }
    else { bones.forEach((b, i) => { state.t[i * 3] = b.rotation.x; state.t[i * 3 + 1] = b.rotation.y; state.t[i * 3 + 2] = b.rotation.z; }); }
    const k = Math.min(1, dt * 24);   // per-bone follow: chained moves blend through each other instead of popping
    for (let i = 0; i < state.t.length; i++) state.c[i] += (state.t[i] - state.c[i]) * k;
    const w = state.w;
    bones.forEach((b, i) => { b.rotation.x += (state.c[i * 3] - b.rotation.x) * w; b.rotation.y += (state.c[i * 3 + 1] - b.rotation.y) * w; b.rotation.z += (state.c[i * 3 + 2] - b.rotation.z) * w; });
    // whole-body turns, not smoothed (continuous 0..2pi): spin hook kick, flips/cartwheels around the hips
    if (mv && mv.id === 3) { const u = Math.min(1, mv.t / MOVES[3].dur), sp = cstep(Math.max(0, Math.min(1, (u - 0.08) / 0.72))); h.rotation.y += sp * Math.PI * 2; }
    if (mv && mv.id === 5) { const u = Math.min(1, mv.t / MOVES[5].dur); rig.b.hips.rotation.x += cstep(Math.min(1, u / 0.5)) * 0.6 * (1 - cstep(Math.max(0, (u - 0.6) / 0.4))); }
    if (fl) { const u = Math.min(1, fl.t / fl.dur), a = cstep(u) * Math.PI * 2 * fl.dir; if (fl.ax === 'x') rig.b.hips.rotation.x += a; else rig.b.hips.rotation.z += a; }
}
export const SNARE_PULSE_SEGMENTS = 2;
export const SNARE_RING_SEGMENTS = 16;
export const SHADOW_SNARE_COLOR = '#a855f7';
export function writeSnarePulse(a: THREE.BufferAttribute, start: number, hx: number, hy: number, hz: number, tx: number, ty: number, tz: number, progress: number, seed: number) {
    const p = Math.max(0, Math.min(1, progress)), span = 0.11, t0 = Math.max(0, p - span), t1 = Math.min(1, p + span), tm = (t0 + t1) * 0.5;
    const dx = tx - hx, dy = ty - hy, dz = tz - hz, side = Math.hypot(dx, dz) || 1, jitter = Math.sin(seed + p * 18) * 0.18;
    const ox = -dz / side * jitter, oz = dx / side * jitter;
    const x0 = hx + dx * t0, y0 = hy + dy * t0, z0 = hz + dz * t0;
    const xm = hx + dx * tm + ox, ym = hy + dy * tm + Math.cos(seed + p * 14) * 0.12, zm = hz + dz * tm + oz;
    const x1 = hx + dx * t1, y1 = hy + dy * t1, z1 = hz + dz * t1;
    a.setXYZ(start * 2, x0, y0, z0); a.setXYZ(start * 2 + 1, xm, ym, zm);
    a.setXYZ((start + 1) * 2, xm, ym, zm); a.setXYZ((start + 1) * 2 + 1, x1, y1, z1);
    return start + SNARE_PULSE_SEGMENTS;
}
export function writeSnareRing(a: THREE.BufferAttribute, start: number, x: number, y: number, z: number, radius: number) {
    for (let i = 0; i < SNARE_RING_SEGMENTS; i++) { const a0 = i / SNARE_RING_SEGMENTS * Math.PI * 2, a1 = (i + 1) / SNARE_RING_SEGMENTS * Math.PI * 2, o = (start + i) * 2; a.setXYZ(o, x + Math.cos(a0) * radius, y, z + Math.sin(a0) * radius); a.setXYZ(o + 1, x + Math.cos(a1) * radius, y, z + Math.sin(a1) * radius); }
    return start + SNARE_RING_SEGMENTS;
}
export function SnareLines({ sim }: { sim: Sim }) {
    const ref = useRef<THREE.LineSegments>(null!), shockRef = useRef<THREE.LineSegments>(null!);
    const lineMat = useRef<THREE.LineBasicMaterial>(null!), shockMat = useRef<THREE.LineBasicMaterial>(null!);
    const geo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SNARE.MAX_TARGETS * 2 + 2) * 2 * 3), 3)); return g; }, []);
    const shockGeo = useMemo(() => { const cap = SNARE.MAX_TARGETS * 2 * SNARE_PULSE_SEGMENTS + SNARE.MAX_TARGETS * SNARE_RING_SEGMENTS, g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 2 * 3), 3)); return g; }, []);
    useFrame(() => {
        const sa = sim as any, a = geo.attributes.position as THREE.BufferAttribute, sh = shockGeo.attributes.position as THREE.BufferAttribute;
        const sn = sa.snareT || 0, hw = sa.handW as number[][] | undefined, targets = (sa.snareList || []) as Sim['enemies']; let n = 0, pn = 0, rn = 0, shockProgress = 0;
        for (let i = 0; i < Math.min(SNARE.MAX_TARGETS, targets.length); i++) {
            const e = targets[i]; if (e.down > 0) continue; const ty = e.y + ((e as any).ly || 0) + enemyBodyOffset(e);
            for (let sd = 0; sd < 2; sd++) {
                const hp = hw ? hw[sd] : [sim.pos[0], sim.pos[1] + 1.5, sim.pos[2]], o = n * 2; a.setXYZ(o, hp[0], hp[1], hp[2]); a.setXYZ(o + 1, e.x, ty, e.z); n++;
                if (sn > SNARE.IMPACT && sn <= SNARE.SHOCK_START) { const p = 1 - (sn - SNARE.IMPACT) / (SNARE.SHOCK_START - SNARE.IMPACT); shockProgress = p; pn = writeSnarePulse(sh, pn, hp[0], hp[1], hp[2], e.x, ty, e.z, p, i * 3.1 + sd * 1.7); }
            }
            if (sn > 0 && sn <= SNARE.IMPACT) { const p = 1 - sn / SNARE.IMPACT; rn = writeSnareRing(sh, rn, e.x, ty, e.z, 0.35 + p * 1.75); }
        }
        { const cw = sa.cWeb; if (cw && cw.e && cw.e.down <= 0) { const e = cw.e, ty = e.y + (e.ly || 0) + enemyBodyOffset(e); for (let sd = cw.mode === 'yank' ? 0 : 1; sd < 2; sd++) { const o = n * 2, hp = hw ? hw[sd] : [sim.pos[0], sim.pos[1] + 1.5, sim.pos[2]]; a.setXYZ(o, hp[0], hp[1], hp[2]); a.setXYZ(o + 1, e.x, ty, e.z); n++; } } }
        geo.setDrawRange(0, n * 2); a.needsUpdate = true; ref.current.visible = n > 0;
        shockGeo.setDrawRange(0, (pn + rn) * 2); sh.needsUpdate = true; shockRef.current.visible = pn + rn > 0;
        if (lineMat.current) { lineMat.current.color.set(sn > 0 ? SHADOW_SNARE_COLOR : '#ffffff'); lineMat.current.opacity = sn > 0 ? 0.98 : 0.86; }
        if (shockMat.current) shockMat.current.color.set(sn > 0 ? SHADOW_SNARE_COLOR : '#ffffff');
        if (DBG) (window as any).__shadowSnareFx = { webLines: n, pulseSegments: pn, ringSegments: rn, pulseProgress: shockProgress, snareColor: sn > 0 ? SHADOW_SNARE_COLOR : null, strandColor: lineMat.current?.color.getHexString(), shockColor: shockMat.current?.color.getHexString() };
    });
    return <>
        <lineSegments ref={ref} geometry={geo} frustumCulled={false}><lineBasicMaterial ref={lineMat} color="#ffffff" transparent opacity={0.86} depthTest={false} depthWrite={false} /></lineSegments>
        <lineSegments ref={shockRef} geometry={shockGeo} frustumCulled={false}><lineBasicMaterial ref={shockMat} color="#ffffff" transparent opacity={0.98} depthTest={false} depthWrite={false} /></lineSegments>
    </>;
}
const Y = new THREE.Vector3(0, 1, 0);

const _gq = new THREE.Quaternion(), _gz = new THREE.Vector3(0, 0, 1), _hp = new THREE.Vector3(), _fp = new THREE.Vector3(), _wd2 = new THREE.Vector3();

const _aq = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _p1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _d1 = new THREE.Vector3();
// two-hand aim: point a bone's segment (bone -> child) at a world target (rotation in world space, applied to the local quaternion)
function aimBone(bone: THREE.Bone, child: THREE.Object3D, target: THREE.Vector3, w: number) {
    bone.getWorldPosition(_p1); child.getWorldPosition(_p2); _p2.sub(_p1).normalize(); _d1.copy(target).sub(_p1).normalize();
    _aq.setFromUnitVectors(_p2, _d1); if (w < 1) _aq.slerp(_id, 1 - w); _aq.invert().invert();
    bone.parent!.getWorldQuaternion(_pq); bone.quaternion.premultiply(_pq.clone().invert().multiply(_aq).multiply(_pq));
}
const _id = new THREE.Quaternion(), _tg = new THREE.Vector3();
export type HeroClipState = { key: string; t: number; w: number };
export function createHeroClipState(): HeroClipState { return { key: '', t: 0, w: 0 }; }
export type HeroRootPoseState = { lean: number; glideBlend: number; bank: number; yaw: number; swimWave: number };
export type HeroAnimationFrame = { clipState: HeroClipState; poseState?: CombatPoseState; sourceClipState?: HeroClipState; poseDt?: number; glideBlend: number; publishState?: boolean };
export function applyHeroRootPose(sim: any, rig: any, dt: number, state: any, position: ArrayLike<number>, scale: number, sourcePose?: HeroRootPoseState, publishState = true) {
    const root = rig.root as THREE.Group, poseRoot = rig.poseRoot as THREE.Group, sa = sim as any;
    root.position.set(position[0], position[1] - 1, position[2]);
    root.scale.setScalar(scale);
    if (sim.wall) { root.position.x += Math.sin(sim.ang) * 0.2; root.position.z += Math.cos(sim.ang) * 0.2; }
    if (sourcePose) state.swW = sourcePose.swimWave;
    if (sim.swim) {
        if (!sourcePose) { const baseY = waterRenderY(position[0], position[2], sim.t) - waveAtWater(position[0], position[2], sim.t), kw = Math.max(0, Math.min(1, (position[1] - baseY + 2) / 2.3)), wv = waveAtWater(position[0], position[2], sim.t) * kw; state.swW = state.swW === undefined ? wv : state.swW + (wv - state.swW) * Math.min(1, dt * 10); }
        root.position.y = position[1] - 1.7 + (state.swW || 0); root.position.x -= Math.sin(sim.ang) * (sim.dive ? 0.6 : 1.3); root.position.z -= Math.cos(sim.ang) * (sim.dive ? 0.6 : 1.3);
    }
    const oldBlend = state.gB || 0;
    state.gB = sourcePose?.glideBlend ?? oldBlend + ((sim.glideOn ? 1 : 0) - oldBlend) * Math.min(1, dt * 3.5);
    const lean = sourcePose?.lean ?? ((sim.swim ? (sim.dive ? 1.9 : 1.45) : sim.wall ? 0.32 : sim.web ? 0.5 : sim.ground ? 0.12 : 0.3) * (1 - state.gB * 0.8) + state.gB * 1.12);
    root.rotation.set(0, sim.ang, 0);
    poseRoot.rotation.set(lean, 0, 0); poseRoot.rotation.order = 'ZXY';
    let bank = sourcePose?.bank;
    if (bank === undefined) {
        const yr = state.bYaw === undefined ? 0 : ((sim.yaw - state.bYaw + Math.PI * 3) % (Math.PI * 2) - Math.PI) / Math.max(dt, 1e-3);
        state.bYaw = sim.yaw; state.bR = (state.bR || 0) + (Math.max(-0.5, Math.min(0.5, -yr * 0.9)) * state.gB - (state.bR || 0)) * Math.min(1, dt * 4); bank = state.bR;
    } else { state.bYaw = sourcePose!.yaw; state.bR = bank; }
    poseRoot.rotation.z = bank;
    if (state.gB > 0.01) { const lc = 0.9 * state.gB; root.position.x -= Math.sin(sim.ang) * Math.sin(lean) * lc; root.position.z -= Math.cos(sim.ang) * Math.sin(lean) * lc; root.position.y += (1 - Math.cos(lean)) * lc * 0.6; }
    root.position.y -= sim.land * 0.5;
    poseRoot.rotation.x += sim.land * 0.5 + (sim.dodgeT > 0 && !sa.flip ? 0.6 : 0);
    const rootPose = { lean, glideBlend: state.gB, bank, yaw: sim.yaw, swimWave: state.swW || 0 };
    if (publishState) sa.__heroRootPoseState = rootPose;
    return rootPose;
}
export function animateHeroBones(sim: any, rig: any, dt: number, frame: HeroAnimationFrame) {
    const { clipState, poseState, sourceClipState, poseDt = dt, glideBlend, publishState = true } = frame;
    const h = rig.root, poseRoot = rig.poseRoot as THREE.Group, sa = sim as any, v = sim.vel;
    rig.bones.forEach((b: THREE.Bone) => b.rotation.set(0, 0, 0));
    const speed = Math.hypot(v[0], v[1], v[2]), hs = Math.hypot(v[0], v[2]);
    const legR = rig.b.thighR as THREE.Bone, legL = rig.b.thighL as THREE.Bone;
    const armR = rig.b.uarmR as THREE.Bone, armL = rig.b.uarmL as THREE.Bone;
    const sw = sim.ground ? Math.sin(sim.runPhase * 3) * 0.9 * Math.min(1, hs / 6) : 0.25;
    legR.rotation.x = sw; legL.rotation.x = -sw; armL.rotation.x = -sw * 0.8;
    if (sim.swim) { const cs = Math.sin(sim.runPhase * 2.4); legR.rotation.x = cs * 0.5; legL.rotation.x = -cs * 0.5; armL.rotation.x = -2.6 + cs * 1.2; }
    if (sim.wall) { const moving = Math.min(1, speed / 7), cw = Math.sin(sim.runPhase * 2.5) * moving; legR.rotation.x = -0.3 + cw * 1.05; legL.rotation.x = -0.3 - cw * 1.05; armL.rotation.x = -1.35 - cw * 0.8; }
    armR.rotation.x = sim.swim ? -2.6 - Math.sin(sim.runPhase * 2.4) * 1.2 : sim.wall ? -1.35 + Math.sin(sim.runPhase * 2.5) * 0.8 * Math.min(1, speed / 7) : sim.web ? (sim.swings % 2 === 1 ? -2.7 : -0.5) : sim.atkT > 0 ? -1.5 - Math.sin((0.32 - sim.atkT) * 10) * 0.6 : sw * 0.8;
    if (sim.web && !sim.swim && !sim.wall) armL.rotation.x = sim.swings % 2 === 0 ? -2.7 : -0.5;
    if (sa.kick && sim.atkT > 0 && sim.shotT <= 0) { const kp = Math.sin((1 - sim.atkT / 0.32) * Math.PI); legR.rotation.x = -1.7 * kp; legL.rotation.x = 0.15; armR.rotation.x = -0.8; armL.rotation.x = -1.2; }
    if (sim.glideOn && !(sa.snareT > 0)) { armR.rotation.x = -0.1; armL.rotation.x = -0.1; armR.rotation.z = 1.3; armL.rotation.z = -1.3; const gt = Math.sin(sim.t * 5) * 0.05; legR.rotation.x = 0.12 + gt; legL.rotation.x = 0.06 - gt; }
    const sn = sa.snareT || 0;
    if (sn > 0) {
        if (sn > SNARE.GATHER_END) { armR.rotation.x = -1.35; armL.rotation.x = -1.35; legR.rotation.x = -0.2; legL.rotation.x = 0.1; }
        else { const charge = sn <= SNARE.SHOCK_START ? Math.sin((SNARE.SHOCK_START - sn) * 18) * 0.035 : 0; armR.rotation.x = -1.22 - charge; armL.rotation.x = -1.22 - charge; armR.rotation.z = -0.2; armL.rotation.z = 0.2; legR.rotation.x = -0.2; legL.rotation.x = 0.1; }
    }
    { const tR = legR.rotation.x, tL = legL.rotation.x, tuck = sim.ground || sim.glideOn || sim.wall ? 0 : 0.35; rig.b.shinR.rotation.x = Math.max(0, tR) * 0.9 + 0.08 + tuck; rig.b.shinL.rotation.x = Math.max(0, tL) * 0.9 + 0.08 + tuck; rig.b.farmR.rotation.x = sn > 0 ? -0.9 : -0.35 + Math.min(0, armR.rotation.x + 1.2) * 0.2; rig.b.farmL.rotation.x = sn > 0 ? -0.9 : -0.35 + Math.min(0, armL.rotation.x + 1.2) * 0.2; rig.b.spine.rotation.x = Math.sin(sim.runPhase * 3) * 0.04 * (sim.ground ? 1 : 0); }
    const ck = (sa.mv || sa.flip || sn > 0 || (sim.glideOn && glideBlend > 0.3)) ? '' : sim.swim ? 'swim' : sim.wall ? 'wall' : sim.atkT > 0 && sim.shotT <= 0 ? (sa.kick ? '' : 'punch') : (!sim.ground && !sim.web) ? 'jump' : (sim.ground && hs < 0.6 && !sim.dive) ? 'idle' : (sim.ground && !sim.web) ? 'run' : '';
    const cs = clipState;
    if (sourceClipState) { cs.key = sourceClipState.key; cs.t = sourceClipState.t; cs.w = sourceClipState.w; }
    else {
        if (ck !== cs.key) cs.key = ck || cs.key;
        cs.w += ((ck ? 1 : 0) - cs.w) * Math.min(1, dt * 10);
        if (ck) {
            const c = CLIPS[ck];
            if (ck === 'wall') cs.t += dt * Math.min(1.6, speed / 3);
            else if (ck === 'swim') cs.t += dt * (0.6 + Math.min(1.2, speed / 8));
            else if (ck === 'punch') cs.t = 0.10 + (0.32 - sim.atkT) * 2.0;
            else if (ck === 'jump') cs.t = (c.n / c.fps) * 0.5;
            else if (ck === 'run') cs.t += dt * Math.max(0.5, Math.min(2, hs / 5.5));
            else cs.t += dt;
        }
    }
    if (cs.key === 'swim' || cs.key === 'wall') poseRoot.rotation.x *= 1 - cs.w * 0.9; else if (cs.key === 'run') poseRoot.rotation.x *= 1 - cs.w * 0.7;
    rig.b.head.rotation.x = -poseRoot.rotation.x * 0.5;
    if (cs.w > 0.02 && (cs.key === 'run' || cs.key === 'idle') && CLIPS[cs.key].hy) { const c = CLIPS[cs.key], fi = Math.floor(((cs.t * c.fps) % c.n + c.n) % c.n); rig.b.hips.position.y = rig.hipsY + (c.hy[fi] - 1) * (cs.key === 'idle' ? 0.3 : 0.6) * cs.w; } else rig.b.hips.position.y = rig.hipsY;
    if (cs.w > 0.02 && CLIPS[cs.key]) sampleClip(CLIPS[cs.key], cs.t, cs.key === 'wall' || cs.key === 'swim' || cs.key === 'idle' || cs.key === 'run', rig.bones, cs.w);
    if (sim.shotT > 0 || sim.spring > 0) { const tg = sim.shotT > 0 ? sim.shotTgt : sim.anchor, wt = Math.min(1, (sim.shotT > 0 ? sim.shotT : sim.spring) / 0.12); rig.root.updateWorldMatrix(true, true); _tg.set(tg[0], tg[1], tg[2]); for (const side of ['L', 'R']) { aimBone(rig.b['uarm' + side], rig.b['farm' + side], _tg, wt); rig.root.updateWorldMatrix(true, true); aimBone(rig.b['farm' + side], rig.b['hand' + side], _tg, wt); rig.root.updateWorldMatrix(true, true); } }
    const activePoseState = poseState ?? _cp;
    combatPose(sim, rig, h, poseDt, activePoseState);
    if (publishState && !sourceClipState) {
        sa.__heroClipState = { key: cs.key, t: cs.t, w: cs.w };
        const sharedPose = sa.__heroPoseState ?? (sa.__heroPoseState = { w: 0, c: new Float32Array(activePoseState.c.length), t: new Float32Array(activePoseState.t.length) });
        sharedPose.w = activePoseState.w; sharedPose.c.set(activePoseState.c); sharedPose.t.set(activePoseState.t);
    }
    const zip = sim.web && sim.webT < 1.6 && sim.anchor[1] - sim.pos[1] > 25 && Math.hypot(sim.anchor[0] - sim.pos[0], sim.anchor[1] - sim.pos[1], sim.anchor[2] - sim.pos[2]) < sim.rope - 0.5;
    const action = sn > 0 ? 'shadow-snare' : sa.mv ? `move-${sa.mv.id}` : sa.flip ? 'dodge-flip' : sim.shotT > 0 ? 'plasma-web-shot' : sim.spring > 0 ? 'web-spring-launch' : sim.web ? (zip ? 'street-zip-up' : 'web-swing') : sim.swim ? (sim.dive ? 'dive' : 'swim') : sim.wall ? 'wall-crawl' : sim.wallT > 0 ? 'wall-jump' : sim.glideOn ? (sa.flightBoost ? 'powered-flight' : 'glide') : !sim.ground ? (sa.glideBlocked || sa.flightTapCancel ? 'glide-cancel' : sa.leapT > 0 ? 'shore-exit-leap' : 'airborne') : sim.vaulted > 0 && sim.land > 0 ? 'rooftop-vault' : hs > 0.6 ? 'run' : 'idle';
    const snarePhase = sn <= 0 ? 'inactive' : sn > SNARE.GATHER_END ? 'gather' : sn > SNARE.SHOCK_START ? 'grip' : sn > SNARE.IMPACT ? 'shockwave' : 'discharge';
    return { key: ck || '', clipKey: cs.key, t: cs.t, weight: cs.w, frame: cs.key && CLIPS[cs.key] ? (cs.t * CLIPS[cs.key].fps) % CLIPS[cs.key].n : 0, poseWeight: activePoseState.w, action, moveId: sa.mv?.id ?? null, moveT: sa.mv?.t ?? 0, flip: sa.flip ? { t: sa.flip.t, dur: sa.flip.dur, ax: sa.flip.ax, dir: sa.flip.dir } : null, snareT: sn, snarePhase, gripHands: sn > 0 ? 2 : 0, snareTargets: (sa.snareList || []).length, shotT: sim.shotT, spring: sim.spring, aimedHands: sim.shotT > 0 || sim.spring > 0 ? 2 : 0, aimTarget: sim.shotT > 0 ? [...sim.shotTgt] : sim.spring > 0 ? [...sim.anchor] : null, web: sim.web, wall: !!sim.wall, swim: sim.swim, dive: sim.dive, glideOn: sim.glideOn };
}
export interface SceneProps { sim: Sim; ev: Events; coarse: boolean; fx: { fov: number; shake: number }; perf: { scale: number; fps: number; speed: number } }



const _wv = new THREE.Vector3(), _wv2 = new THREE.Vector3();
export function buildRig(data: any = heroData, materialOverride?: THREE.MeshLambertMaterial) {
    const d: any = data;
    if (!d._capeRig && !(DBG && (window as any).__noCapeRig)) {   // user-approved (9:53) hidden cape rig: 3 extra bones + re-weighted cape vertices only. Rest pose is unchanged (new bones sit at identity under chest), mesh/UV/texture untouched.
        d._capeRig = true;
        const base = d.bones.length; d.bones.push({ n: 'cape1', p: 2, h: [0, 1.58, -0.13] }, { n: 'cape2', p: base, h: [0, 1.4, -0.15] }, { n: 'cape3', p: base + 1, h: [0, 1.27, -0.17] });
        const ids = [2, base, base + 1, base + 2], P = d.pos; let cnt = 0;
        for (let i = 0; i < P.length / 3; i++) {
            const y = P[i * 3 + 1], z = P[i * 3 + 2]; if (!(z < -0.12 && y > 1.15 && y < 1.7)) continue;
            const u = Math.max(0, Math.min(2.999, (1.58 - y) / 0.38 * 3)), k = Math.floor(u), f = u - k;
            d.si[i * 4] = ids[k]; d.si[i * 4 + 1] = ids[k + 1]; d.si[i * 4 + 2] = 0; d.si[i * 4 + 3] = 0;
            d.sw[i * 4] = 1 - f; d.sw[i * 4 + 1] = f; d.sw[i * 4 + 2] = 0; d.sw[i * 4 + 3] = 0; cnt++;
        }
        if (DBG) (window as any).__capeVerts = cnt;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(d.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
    if (d.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(d.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(d.sw, 4));
    g.setIndex(d.idx);
    if (d.rebuildNormals) g.computeVertexNormals();
    const bones: THREE.Bone[] = [], byName: Record<string, THREE.Bone> = {};
    d.bones.forEach((b: any, i: number) => {
        const bone = new THREE.Bone(); bone.name = b.n; bones.push(bone); byName[b.n] = bone;
        const par = b.p >= 0 ? d.bones[b.p].h : [0, 0, 0];
        bone.position.set(b.h[0] - par[0], b.h[1] - par[1], b.h[2] - par[2]);
        if (b.p >= 0) bones[b.p].add(bone);
    });
    let mat: THREE.MeshLambertMaterial;
    if (materialOverride) mat = materialOverride;
    else if (d.uv) {
        const tex = new THREE.TextureLoader().load(baseTexUrl); tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 16;   // hero-only path (bots/boss build their own); three clamps to the GPU max
        mat = new THREE.MeshLambertMaterial({ map: tex, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.45 });
    } else mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color('#1a2a66'), emissiveIntensity: 0.18 });
    // procedural suit weave in the fragment shader (object-space lattice, screen-AA'd), so fine detail doesn't depend on vertex density
    if (!d.uv) mat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;').replace('#include <color_fragment>', `#include <color_fragment>
        if (vColor.r < 0.2 && vColor.b > 0.4) {
            float ang = atan(vObj.x, vObj.z) * 4.2;
            vec2 q = vec2(ang, vObj.y * 16.0);
            vec2 w = fwidth(q) * 1.5;
            float lx = smoothstep(0.455 - w.x, 0.455, abs(fract(q.x) - 0.5));
            float ly = smoothstep(0.455 - w.y, 0.455, abs(fract(q.y) - 0.5));
            float line = max(lx, ly);
            diffuseColor.rgb *= 1.0 - 0.38 * line * clamp(1.0 - 2.0 * (w.x + w.y), 0.0, 1.0);
            diffuseColor.rgb *= 1.0 + 0.08 * sin(vObj.y * 90.0 + vObj.x * 40.0);
        }`);
    };
    const mesh = new THREE.SkinnedMesh(g, mat); mesh.frustumCulled = false;
    const root = new THREE.Group(), poseRoot = new THREE.Group(); root.add(poseRoot); poseRoot.add(mesh); mesh.add(bones[0]);
    root.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    // cel-style ink outline: inverted hull sharing the geometry and skeleton, pushed out along the skinned normal (ref: Wind Waker character edge ink)
    { const om = new THREE.MeshBasicMaterial({ color: '#0a0d1a', side: THREE.BackSide }); om.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', 'transformed += normalize(objectNormal) * 0.014;\n#include <project_vertex>'); }; const ol = new THREE.SkinnedMesh(g, om); ol.frustumCulled = false; ol.bind(mesh.skeleton, mesh.bindMatrix); poseRoot.add(ol); }
    // candidate extreme vertices (chosen per dominant bone in many bone-local directions), kept with their full skin blend so wall contact uses real skinned positions
    const hull: { p: THREE.Vector3; bi: number[]; bw: number[]; foot?: boolean }[] = [];
    {
        const inv = mesh.skeleton.boneInverses, pa = g.attributes.position, si = d.si, sw = d.sw, v = new THREE.Vector3();
        const dirs: THREE.Vector3[] = []; for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) dirs.push(new THREE.Vector3(x, y, z).normalize());
        const best = bones.map(() => dirs.map(() => ({ s: -1e9, i: -1 })));
        for (let i = 0; i < pa.count; i++) {
            let bi = si[i * 4], bw = sw[i * 4]; for (let j = 1; j < 4; j++) if (sw[i * 4 + j] > bw) { bw = sw[i * 4 + j]; bi = si[i * 4 + j]; }
            v.set(pa.getX(i), pa.getY(i), pa.getZ(i)).applyMatrix4(inv[bi]);
            dirs.forEach((dr, k2) => { const sc = v.dot(dr); if (sc > best[bi][k2].s) { best[bi][k2].s = sc; best[bi][k2].i = i; } });
        }
        const seen = new Set<number>();
        // exact coverage for the limbs that touch the wall: every vertex dominated by a hand or foot bone
        for (let i = 0; i < pa.count; i++) {
            let bi = si[i * 4], bw = sw[i * 4]; for (let j = 1; j < 4; j++) if (sw[i * 4 + j] > bw) { bw = sw[i * 4 + j]; bi = si[i * 4 + j]; }
            if (/^(hand|foot)/.test(bones[bi].name)) { seen.add(i); hull.push({ p: new THREE.Vector3(pa.getX(i), pa.getY(i), pa.getZ(i)), bi: [0, 1, 2, 3].map((k) => si[i * 4 + k]), bw: [0, 1, 2, 3].map((k) => sw[i * 4 + k]), foot: /^foot/.test(bones[bi].name) }); }
        }
        best.forEach((arr) => arr.forEach((e) => { if (e.i >= 0 && !seen.has(e.i)) { seen.add(e.i); hull.push({ p: new THREE.Vector3(pa.getX(e.i), pa.getY(e.i), pa.getZ(e.i)), bi: [0, 1, 2, 3].map((k) => si[e.i * 4 + k]), bw: [0, 1, 2, 3].map((k) => sw[e.i * 4 + k]) }); } }));
    }
    const skel = mesh.skeleton;
    return { root, poseRoot, b: byName, bones, hull, skel, hipsY: byName.hips.position.y };
}


// Mixamo-derived clips, retargeted offline (tools/fbx2clip.mjs) onto the generated rig
export type Clip = { fps: number; n: number; bones: string[]; q: number[]; hy: number[] };
export const CLIPS: Record<string, Clip> = { idle: clipIdle as any, jump: clipJump as any, wall: clipWall as any, punch: clipPunch as any, swim: clipSwim as any, run: clipRun as any };
const _wd = new THREE.Vector3(), _wp = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
export function sampleClip(c: Clip, t: number, loop: boolean, bones: THREE.Bone[], w: number) {
    let f = t * c.fps; if (loop) f = ((f % c.n) + c.n) % c.n; else f = Math.max(0, Math.min(c.n - 1, f));
    const i0 = Math.floor(f), i1 = loop ? (i0 + 1) % c.n : Math.min(c.n - 1, i0 + 1), k = f - i0, nb = c.bones.length;
    for (let b = 0; b < nb; b++) {
        _qa.fromArray(c.q, (i0 * nb + b) * 4); _qb.fromArray(c.q, (i1 * nb + b) * 4); _qa.slerp(_qb, k);
        bones[b].quaternion.slerp(_qa, w);
    }
}



// Water: sum-of-sines height field, fresnel sky mix, sun glitter, crest foam, distance haze (informed by public ocean-shader write-ups, see docs/REFERENCES.md)

const OCEAN_GEO = oceanGeo(), SEABED_GEO = seabedGeo();


/* Shifat 3:33 AM: '6-7 fps over sea, 8-9 on land' -> on-device bisect. Only with ?debug in the URL (no effect otherwise):
   HUD gets draw calls, triangles and the CPU (JavaScript) ms per frame; ?debug&res=0.3 pins the world resolution, ?debug&nosea hides the sea,
   ?debug&noout turns the ink outline pass off - so a phone can tell GPU fill vs CPU vs a single pass. */
const DQ = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams('');
const DQ_HIDE = (DQ.has('debug') && DQ.get('hide')) ? DQ.get('hide')!.split(',') : [];
const DQ_ON = DQ.has('debug'), DQ_RES = DQ_ON && DQ.get('res') ? Math.max(0.2, Math.min(2, +DQ.get('res')!)) : 0, DQ_NOSEA = DQ_ON && DQ.has('nosea');
if (DQ_ON && DQ.has('noout')) OUTLINE_STATE.on = false;
function DebugStats() {
    const gl = useThree((s) => s.gl), scene = useThree((s) => s.scene);
    const st = useRef({ t0: 0, end: 0, n: 0, cpu: 0, hid: [] as THREE.Object3D[] }).current;
    useEffect(() => {
        if (!DQ_ON) return;
        gl.info.autoReset = false;
        const orig = gl.render.bind(gl);
        (gl as any).render = (a: any, b: any) => { orig(a, b); st.end = performance.now(); };
        return () => { (gl as any).render = orig; gl.info.autoReset = true; };
    }, [gl]);
    useFrame(() => {
        if (!DQ_ON) return;
        const w = window as any;
        if (st.t0 && st.end > st.t0) st.cpu += (st.end - st.t0 - st.cpu) * 0.1;
        w.__dbgStats = { calls: gl.info.render.calls, tris: gl.info.render.triangles, cpu: st.cpu };
        gl.info.reset(); st.t0 = performance.now();
        for (const o of st.hid) o.visible = false;   // components that re-show their meshes every frame are hidden again each frame
        if ((DQ_NOSEA || DQ_HIDE.length) && (st.n++ % 60) === 0) { st.hid.length = 0; scene.traverse((o: any) => {
            if (!(o.isMesh || o.isPoints)) return;
            if (DQ_NOSEA && o.material === waterMat) { o.visible = false; st.hid.push(o); return; }
            let top = '', q = o; while (q) { if (q.name) top = q.name; q = q.parent; }
            const grp = o.material === waterMat ? 'ocean' : o.material === seabedMat ? 'seabed' : top.startsWith('polyfork-city') ? 'city' : top === 'street-props' || top === 'roof-props' ? 'props'
                : top === 'park-ground' ? 'park' : top === 'south-sea' ? 'island' : !top && o.material && o.material.type === 'MeshLambertMaterial' ? 'trees' : !top && o.material && o.material.type === 'ShaderMaterial' ? 'shader' : top;
            if (DQ_HIDE.includes(grp)) { o.visible = false; st.hid.push(o); }
        }); }
    }, -1000);
    return null;
}

export function Scene({ sim, ev, coarse, fx, perf }: SceneProps) {
    const { gl, camera } = useThree();
    const hero = useRef<THREE.Group>(null!), armR = useRef<THREE.Group>(null!), armL = useRef<THREE.Group>(null!), legR = useRef<THREE.Group>(null!), legL = useRef<THREE.Group>(null!), cape = useRef<THREE.Mesh>(null!);
    const web = useRef<THREE.Mesh>(null!), webB = useRef<THREE.Mesh>(null!), arrow = useRef<THREE.Mesh>(null!), cores = useRef<THREE.InstancedMesh>(null!), glows = useRef<THREE.InstancedMesh>(null!);
    const cam = useRef(new THREE.Vector3()), look = useRef(new THREE.Vector3()), adapt = useRef(0), ema = useRef(16), curScale = useRef(perf.scale), hyst = useRef({ s: 0, n: 0, down: -99 });
    const suit = useMemo(() => new THREE.MeshLambertMaterial({ color: '#2d56d0' }), []);
    const ink = useMemo(() => new THREE.MeshBasicMaterial({ color: '#06070f', side: THREE.BackSide }), []);
    const white = useMemo(() => new THREE.MeshLambertMaterial({ color: '#f1f4ff' }), []);
    const hair = useMemo(() => new THREE.MeshLambertMaterial({ color: '#e8ecff' }), []);
    const lens = useMemo(() => { const sh = new THREE.Shape(); sh.moveTo(-0.075, 0.015); sh.lineTo(0.085, 0.045); sh.lineTo(0.065, -0.015); sh.lineTo(-0.055, -0.04); sh.closePath(); return new THREE.ShapeGeometry(sh); }, []);
    const tail1 = useMemo(() => new THREE.PlaneGeometry(0.16, 0.95).translate(0, -0.475, 0), []);
    const tail2 = useMemo(() => new THREE.PlaneGeometry(0.12, 0.7).translate(0, -0.35, 0), []);
    const stripe = useMemo(() => new THREE.MeshBasicMaterial({ color: '#5ff2ff', transparent: true, opacity: 0.5, blending: THREE.NoBlending }), []);
    const gold = useMemo(() => new THREE.MeshLambertMaterial({ color: '#f2c038' }), []);
    const dark = useMemo(() => new THREE.MeshLambertMaterial({ color: '#232a4a' }), []);
    const red = useMemo(() => new THREE.MeshLambertMaterial({ color: '#d9344f', side: THREE.DoubleSide }), []);
    const bv = useMemo(() => new THREE.Vector3(), []);
    const bv2 = useMemo(() => new THREE.Vector3(), []);
    const waterRef = useRef<THREE.Mesh>(null!), ringRef = useRef<THREE.Mesh>(null!);
    const wakeRef = useRef<THREE.Mesh>(null!); const ringFlow = useRef(0);
    const wakeTrail = useRef<{x:number,z:number,t:number}[]>([]); const wakeStrength = useRef(0); const wakeBorn = useRef(0);
    const wakeGeo = useMemo(() => { const g = new THREE.BufferGeometry(), pa = new Float32Array(2 * 25 * 2 * 3), uv = new Float32Array(2 * 25 * 2 * 2), ix: number[] = []; for (let side = 0; side < 2; side++) for (let j = 0; j <= 24; j++) { const n = side * 50 + j * 2; uv[n*2] = uv[(n+1)*2] = j/24; uv[n*2+1] = 0; uv[(n+1)*2+1] = 1; if (j < 24) ix.push(n,n+1,n+2,n+1,n+3,n+2); } g.setAttribute('position', new THREE.BufferAttribute(pa, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(ix); return g; }, []);
    const wakeMat = useMemo(() => new THREE.ShaderMaterial({transparent:true, depthWrite:false, side:THREE.DoubleSide, uniforms:{uA:{value:0}}, vertexShader:'varying vec2 vU; void main(){vU=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'varying vec2 vU; uniform float uA; void main(){float soft=sin(vU.y*3.14159);float trail=pow(1.0-vU.x,1.5)*smoothstep(0.0,0.12,vU.x); gl_FragColor=vec4(0.82,0.96,1.0,soft*trail*uA);}' }), []);
 const splashRef = useRef<THREE.Group>(null!), splashSt = useRef({ prev: false, t0: -9 });
    const rig = useMemo(() => {
        const r = buildRig();
        const redM = new THREE.MeshLambertMaterial({ color: '#d4162e', side: THREE.DoubleSide });
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.11, 0.06, 10), redM); ring.position.set(0, 0.04, 0); r.b.neck.add(ring);
        const t1 = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.8).translate(0, -0.4, 0), redM); t1.position.set(0, 0.38, -0.1); r.b.chest.add(t1);
        const t2 = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.55).translate(0, -0.275, 0), redM); t2.position.set(0.07, 0.36, -0.1); t2.rotation.set(0.1, 0, 0.14); r.b.chest.add(t2);
        ring.visible = false; t1.visible = false; t2.visible = false;   // model has its own cloth; legacy red scarf removed
        legR.current = r.b.thighR as any; legL.current = r.b.thighL as any; armR.current = r.b.uarmR as any; armL.current = r.b.uarmL as any; cape.current = t1 as any;
        if (DBG) (window as any).__rig = r; return r;
    }, []);
    useEffect(() => registerHero(rig.root), [rig]);   // Shadow joins the hero HD pass
    const clipSt = useRef(createHeroClipState()), poseSt = useRef(createCombatPoseState());
    const lastWall = useRef<{ n: number[]; b: number } | null>(null), wallCorr = useRef(0), groundCorr = useRef(0), groundMin = useRef({ key: '', v: 1e9 }), tp0 = useMemo(() => new THREE.Vector3(), []);
    const enemyTime = useRef({ value: 0 });
    const enemySet = useMemo(() => [0, 1, 2, 3].map((k) => buildEnemy(k, enemyTime.current)), []);
    const enMeshes = useRef<THREE.InstancedMesh[]>([]);
    const ecol = useMemo(() => new THREE.Color(), []);
    const beaconRef = useRef<THREE.Mesh>(null!);
    const eye = useMemo(() => new THREE.MeshBasicMaterial({ color: '#8ffcff', side: THREE.DoubleSide, transparent: true, opacity: 0.5, blending: THREE.NoBlending }), []);
    const visor = useMemo(() => new THREE.MeshBasicMaterial({ color: '#0b0c18' }), []);

    useFrame((state, rawDt) => {
        const dt = Math.min(0.1, rawDt) * (DBG && (window as any).__ts != null ? (window as any).__ts : 1);   /* Shifat 9:33 AM 'animation feels slow on ocean': the 50 ms cap made the whole game run in slow motion below 20 fps; now real time down to 10 fps */   // test hook: frame-exact stills
        sim.t += dt;
        // adaptive resolution (device-friendly)
        const rd = Math.min(0.25, rawDt); ema.current += (rd * 1000 - ema.current) * 0.05; perf.fps = 1000 / ema.current; adapt.current += rd;
        { const want = Math.min(window.devicePixelRatio || 1, coarse ? QK.dprCap : QK.dprCap) * curScale.current; applyRatio(gl, want); }   // world ratio unchanged; the canvas runs at native for the hero HD pass
        if (adapt.current > 0.8) {
            adapt.current = 0; let ns = curScale.current;
            /* Shifat 6:56 PM 'performance spikes near water': every scale step re-allocates the world/outline/copy render targets (a visible hitch), and the scaler
               used to bounce (down at >24 ms, up at <18 ms, checked every 0.8 s). Now a step needs the same verdict 2 checks in a row, and an up-step also waits 6 s after a down-step. */
            const sd = coarse && ns <= 1 ? (ema.current > 40 && ns > 0.65 ? -0.1 : ema.current < 30 && ns < 1 ? 0.05 : 0)   /* Shifat 11:19 AM 'phone should lower res when frames go slow too': below 25 fps a touch device steps the world res down (floor 0.6), and back up once it holds 33+ fps; heroes stay native in the HD pass */
                : ema.current > 24 && ns > (coarse ? 1 : 0.6) ? -0.1  /* RCA Shifat 3:54 AM: ?debug&noout looked best because it drew the world at the phone's native res with the SAME 6-7 fps -> the phone is not fill-bound, so touch devices never drop below full res (floor 1) */ : ema.current > 16 && ns > 1 ? -0.05 : ema.current < 12.5 && ns >= 1 && ns < QK.maxScale && (coarse || HQ) ? 0.05 : ema.current < 18 && ns < 1 ? 0.05 : 0;
            const sg = Math.sign(sd); hyst.current.n = sg !== 0 && sg === hyst.current.s ? hyst.current.n + 1 : sg !== 0 ? 1 : 0; hyst.current.s = sg;
            if (sd !== 0 && hyst.current.n >= 2 && (sd < 0 || sim.t - hyst.current.down > 6)) { ns = sd < -0.06 ? ns - 0.1 : sd < 0 ? Math.max(1, ns - 0.05) : ns + 0.05; hyst.current.n = 0; if (sd < 0) hyst.current.down = sim.t; }   // supersample tier: touch devices or ?q=high desktops running well under budget (<12.5 ms), reversible by the same >24 ms downshift
            if (DBG && (window as any).__perfPin) ns = (window as any).__perfPin;
            if (DQ_RES) ns = DQ_RES;   // ?debug&res=x: hold the world resolution for an on-device fill-rate test   // screenshot harness only: hold the scaler so a software renderer does not drop tiers
            if (Math.abs(ns - curScale.current) > 0.01) { curScale.current = ns; perf.scale = ns; applyRatio(gl, Math.min(window.devicePixelRatio || 1, coarse ? QK.dprCap : QK.dprCap) * ns); }
        }
        if (sim.mode === 'play') {
            { const n = Math.max(2, Math.ceil(dt / 0.025)); for (let i = 0; i < n; i++) stepSim(sim, dt / n, ev); }   // same <=25 ms physics steps as before
            stepBeacon(sim, ev);
            sim.time += dt;
        } else sim.yaw += dt * 0.15;
        const p = sim.pos, v = sim.vel;
        const speed = Math.hypot(v[0], v[1], v[2]); perf.speed = speed;
        // camera
        const cy = Math.cos(sim.pitch), sy = Math.sin(sim.pitch);
        const dbgD = DBG ? (window as any).__camDist as number | undefined : undefined; if (DBG && (window as any).__hq) { curScale.current = 1; perf.scale = 1; }
        let dist = dbgD ?? ((sim as any).riding ? 17 : sim.web ? 11.5 : sim.wall ? 7 : 8.5);   // flying a car: pull the camera back so the car doesn't fill the screen
        const fxd = Math.sin(sim.yaw) * cy, fzd = Math.cos(sim.yaw) * cy;
        for (; !dbgD && dist > (sim.wall ? 5 : 6); dist -= 1) {
            const ex = p[0] - fxd * dist, ey = p[1] + 1.5 + sy * dist, ez = p[2] - fzd * dist;
            let hit = false;
            for (const b of buildings) if (ex > b.x0 - 3 && ex < b.x1 + 3 && ez > b.z0 - 3 && ez < b.z1 + 3 && ey < b.h + 3) { hit = true; break; }
            if (!hit) break;
        }
        const wsh = 0, wnx = sim.wall ? -sim.wall[1] : 0, wnz = sim.wall ? sim.wall[0] : 0; // Manual orbit has no forced wall-side offset
        const tx = p[0] - fxd * dist + wnx * wsh, ty = p[1] + (sim.swim ? 0.7 : 1.5) + sy * dist, tz = p[2] - fzd * dist + wnz * wsh;
        if (sim.mode === 'menu' || sim.mode === 'over') { cam.current.set(tx, ty, tz); } else cam.current.lerp(new THREE.Vector3(tx, ty, tz), 1 - Math.pow(0.001, dt));
        { // push smoothed camera out of buildings (post-lerp)
            const q = cam.current;
            for (const b of buildings) if (q.x > b.x0 - 2 && q.x < b.x1 + 2 && q.z > b.z0 - 2 && q.z < b.z1 + 2 && q.y < b.h + 2) {
                if (!(tx > b.x0 - 2 && tx < b.x1 + 2 && tz > b.z0 - 2 && tz < b.z1 + 2 && ty < b.h + 2)) { q.set(tx, ty, tz); continue; }
                const dx0 = q.x - (b.x0 - 2), dx1 = b.x1 + 2 - q.x, dz0 = q.z - (b.z0 - 2), dz1 = b.z1 + 2 - q.z, dy = b.h + 2 - q.y, m = Math.min(dx0, dx1, dz0, dz1, dy);
                if (m === dy) q.y = b.h + 2; else if (m === dx0) q.x = b.x0 - 2; else if (m === dx1) q.x = b.x1 + 2; else if (m === dz0) q.z = b.z0 - 2; else q.z = b.z1 + 2;
            }
        }
        { // Keep the smoothed chase arm outside the solid quay and above inland ground.
            // If the sightline enters the shore wall below its top, shorten on the water side.
            const q = cam.current, edge = WATER_Z - 0.9, ly = sim.swim ? p[1] + 0.7 : p[1] + 1.5;
            if (p[2] < edge && q.z > edge) {
                const f = (edge - p[2]) / (q.z - p[2]);
                const iy = ly + (q.y - ly) * f;
                if (iy < 0.7) { q.x = p[0] + (q.x - p[0]) * f; q.y = iy; q.z = edge; }
            }

        }
        { // Orbit obstruction shortens the arm; it does not change the selected angles.
            const q=cam.current,ax=p[0],ay=p[1]+(sim.swim?.7:1.5),az=p[2];
            const dx=q.x-ax,dy=q.y-ay,dz=q.z-az;let safe=1;
            // Segment-vs-building slabs catch walls even when the endpoint is outside.
            for(const b of buildings){let lo=0,hi=safe;const origin=[ax,ay,az],delta=[dx,dy,dz],mn=[b.x0-.35,-1000,b.z0-.35],mx=[b.x1+.35,b.h+.35,b.z1+.35];let hit=true;
                for(let k=0;k<3;k++){if(Math.abs(delta[k])<1e-7){if(origin[k]<mn[k]||origin[k]>mx[k]){hit=false;break;}}else{let a=(mn[k]-origin[k])/delta[k],c=(mx[k]-origin[k])/delta[k];if(a>c){const t=a;a=c;c=t;}lo=Math.max(lo,a);hi=Math.min(hi,c);if(lo>hi){hit=false;break;}}}
                if(hit&&lo>0)safe=Math.max(0,lo-.025);
            }
            for(let i=1;i<=32;i++){const f=safe*i/32,x=ax+dx*f,y=ay+dy*f,z=az+dz*f;const ihc=z<WATER_Z?islandH(x,z):null;const floor=z<WATER_Z?(ihc!==null?ihc:seabedAt(x,z)):Math.min(0,parkH(x,z));   /* 1:21 AM Shifat 'island lake camera bug': seabedAt ignores the carved lake/river/pool, so the arm hit 'ground' above the water and collapsed into the swimmer */if(y<floor+.35){safe=safe*(i-1)/32;break;}}
            if(safe<1)q.set(ax+dx*safe,ay+dy*safe,az+dz*safe);
        }
        camera.position.copy(cam.current); { const shk = (sim as any).shake || 0; if (shk > 0.001) { const a = shk * shk * 2.2, tt = sim.t * 61; camera.position.x += Math.sin(tt * 1.3) * a; camera.position.y += Math.sin(tt * 1.9 + 1.7) * a * 0.8; camera.position.z += Math.sin(tt * 1.1 + 4.1) * a; } } if (DBG) (window as any).__cam = [cam.current.x, cam.current.y, cam.current.z, dist];
        look.current.set(p[0], sim.swim ? p[1] + 0.7 : p[1] + 1.5, p[2]);
        OCC.uOccHero.value.set(p[0], p[1] + 1.0, p[2]);   // robots/peds between lens and hero dissolve (occlude.ts)
        const ov = DBG ? (window as any).__camOv : null; if (ov) { camera.position.set(ov[0], ov[1], ov[2]); look.current.set(ov[3], ov[4], ov[5]); }
        camera.lookAt(look.current);
        const cp = camera as THREE.PerspectiveCamera;
        // Near-clip-aware waterline: retain the nearby underside instead of cutting a hole through it.
        // Restore the ordinary land frustum away from the bay surface to preserve depth precision.
        const nearWater = (camera.position.z < WATER_Z + 2 && Math.abs(camera.position.y - WATER_Y) < 1.5) || (isLakeWater(camera.position.x, camera.position.z) && Math.abs(camera.position.y - waterSurfaceAt(camera.position.x, camera.position.z, sim.t)) < 1.5);
        const nearTarget = nearWater ? 0.05 : 0.5;
        if (cp.near !== nearTarget) { cp.near = nearTarget; cp.updateProjectionMatrix(); }
        const targetFov = 62 + Math.min(14, speed * 0.25) + fx.fov;
        if (Math.abs(cp.fov - targetFov) > 0.05) { cp.fov += (targetFov - cp.fov) * Math.min(1, dt * 6); cp.updateProjectionMatrix(); }
        {   // water: animate, and split view (waterline across the screen when the camera is at the surface)
            waterMat.uniforms.uTime.value = sim.t; seabedMat.uniforms.uTime.value = sim.t; wallMat.uniforms.uTime.value = sim.t;
            const uw = document.getElementById('uw');
            if (uw) { const dq = Math.round(TOD.day.value * 20); if (uw.dataset.dq !== String(dq)) { uw.dataset.dq = String(dq); const d = dq / 20, k = 0.12 + 0.88 * d, c = (r: number, g: number, b: number, a: number) => `rgba(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)},${(a + (1 - d) * 0.25).toFixed(2)})`;
                uw.style.background = `linear-gradient(180deg, ${c(110, 215, 235, 0.24)}, ${c(30, 140, 175, 0.3)} 45%, ${c(8, 70, 105, 0.5)})`; } }   // underwater tint follows the light: the fixed bright-teal wash used to light up the night sea from inside
            const inBay = camera.position.z < WATER_Z + 2, inLake = isLakeWater(camera.position.x, camera.position.z), inWater = inBay || inLake;
            const surfaceY = inLake ? waterSurfaceAt(camera.position.x, camera.position.z, sim.t) : waterRenderY(camera.position.x, camera.position.z, sim.t); const dy = camera.position.y - surfaceY; const under = inWater && dy < 0;   // env-iter3: ocean uses the real swell height (was the flat sea level, so troughs read as underwater)
            // Shifat Oct 29 "use underwater fogs inside ocean": these statements had slipped into the comment above, so the underwater
            // state never switched on. Now: underwater background + a scene fog that thickens with depth (deeper = darker, shorter view).
            UW.on = under; if (under) (state.scene.background as THREE.Color).copy(UWF.value); if (DBG) (window as any).__scene = state.scene;
            // Shifat Oct 29: "fog should only be visible at great distance, not close" -> linear fog: clear water near you, fog only far off.
            if (!(state.scene.fog instanceof THREE.Fog)) state.scene.fog = new THREE.Fog(UWF.value.getHex(), 1e4, 2e4);   // kept for the whole session (pushed out of reach above water) so entering water causes no shader recompiles
            { const fg = state.scene.fog as THREE.Fog; if (under) { const deep = Math.min(1, Math.max(0, -dy / 30)); fg.color.copy(UWF.value).multiplyScalar(1 - 0.45 * deep); fg.near = 55 - 15 * deep; fg.far = 190 - 50 * deep; (state.scene.background as THREE.Color).copy(fg.color); } else { fg.near = 1e4; fg.far = 2e4; } }
            if (uw) {
                if (inWater && dy < 1.2 && dy > -2.2) {
                    // project the waterline a little ahead of the camera to find where the surface cuts the screen
                    camera.getWorldDirection(_wd); const hx = _wd.x, hz = _wd.z, hl = Math.hypot(hx, hz) || 1;
                    const ax = camera.position.x + hx / hl * 11, az = camera.position.z + hz / hl * 11; _wp.set(ax, waterRenderY(ax, az, sim.t), az).project(camera);
                    const yPct = Math.max(0, Math.min(100, (1 - (_wp.y * 0.5 + 0.5)) * 100));
                    { const mk = `linear-gradient(180deg, transparent ${Math.max(0, yPct - 3)}%, #000 ${Math.min(100, yPct + 7)}%)`; uw.style.maskImage = mk; (uw.style as any).webkitMaskImage = mk; } uw.style.opacity = '1'; uw.dataset.split = '1';   // waterline tint edge fades over about 10% of the screen instead of a hard clip
                } else { uw.style.maskImage = 'none'; (uw.style as any).webkitMaskImage = 'none'; uw.style.opacity = under ? '1' : '0'; uw.dataset.split = '0'; }
            }
        }
        // hero
        const h = hero.current;
        const wl = !!sim.wall;
        { const sg = splashRef.current, st2 = splashSt.current; if (sg) { if (sim.swim && !st2.prev && p[1] > waterSurfaceAt(p[0], p[2], sim.t) - 2.0) st2.t0 = sim.t; st2.prev = sim.swim; const age = sim.t - st2.t0, on = age >= 0 && age < 0.8; sg.visible = on; if (on) { const wy = waterRenderY(p[0], p[2], sim.t), k = age / 0.8, rise = Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5); sg.position.set(p[0], wy, p[2]); sg.children.forEach((c, i) => { const m = c as THREE.Mesh, a2 = (i / 9) * 6.283, tilt = 0.25 + 0.2 * ((i * 7) % 3), h = (0.9 + 0.5 * ((i * 5) % 4) / 3) * rise * (1 - 0.35 * k); m.position.set(Math.cos(a2) * 0.35 * (1 + k), h * 0.5, Math.sin(a2) * 0.35 * (1 + k)); m.rotation.set(Math.sin(a2) * tilt, 0, -Math.cos(a2) * tilt); m.scale.set(1 - 0.5 * k, Math.max(0.01, h), 1 - 0.5 * k); (m.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - k * k); }); } } }   // entry splash: crown of white shards on water entry (ref: stylized splash, spiky white crown over a foam skirt)
        { // original curved two-arm wake: short position history keeps the trail behind a turning swimmer
            const m = wakeRef.current, sp = Math.hypot(v[0],v[2]), surfaceY = waterSurfaceAt(p[0],p[2],sim.t), surface = sim.swim && !sim.dive && p[1] > surfaceY - 1.1;
            const target = surface && sp>0.6 ? Math.min(0.58,sp*0.10) : 0;
            wakeStrength.current += (target-wakeStrength.current)*Math.min(1,dt*(target>0?6:3));
            const trail = wakeTrail.current;
            if(!surface || trail.length && Math.hypot(p[0]-trail[0].x,p[2]-trail[0].z)>12) trail.length=0;
            if(surface && (!trail.length || sim.t-trail[0].t>0.07)){
                // A hard reversal must start a new ribbon rather than join opposing arms across a cusp.
                if(trail.length>3){const a=trail[0],b=trail[3],ox=a.x-b.x,oz=a.z-b.z,ol=Math.hypot(ox,oz);if(ol>0.15&&sp>1.0&&(v[0]*ox+v[2]*oz)/(sp*ol)<0.20){trail.length=0;wakeStrength.current*=0.35;}}
                if(!trail.length)wakeBorn.current=sim.t;trail.unshift({x:p[0],z:p[2],t:sim.t});if(trail.length>28)trail.pop();}
            if(m){m.visible=surface && wakeStrength.current>0.015 && trail.length>2;if(m.visible){const pa=wakeGeo.attributes.position as THREE.BufferAttribute;
                for(let side=0;side<2;side++)for(let j=0;j<=24;j++){const t=j/24,sgn=side?1:-1,fi=t*(trail.length-1),ii=Math.floor(fi),ff=fi-ii,a=trail[ii],b=trail[Math.min(ii+1,trail.length-1)],prev=trail[Math.max(0,ii-1)],next=trail[Math.min(trail.length-1,ii+1)];
                    let dx=prev.x-next.x,dz=prev.z-next.z;const ln=Math.hypot(dx,dz);if(ln>0.02){dx/=ln;dz/=ln;}else{dx=Math.sin(sim.ang);dz=Math.cos(sim.ang);}
                    const cx=a.x+(b.x-a.x)*ff-dx*0.8,cz=a.z+(b.z-a.z)*ff-dz*0.8,spread=0.55+t*1.7,width=0.06+t*0.16;
                    for(let k=0;k<2;k++){const off=sgn*(spread+(k?width:-width)),x=cx-dz*off,z=cz+dx*off;pa.setXYZ(side*50+j*2+k,x,waterRenderY(x,z,sim.t)+0.055,z);}}
                pa.needsUpdate=true;wakeMat.uniforms.uA.value=wakeStrength.current*THREE.MathUtils.smoothstep(sim.t-wakeBorn.current,0.1,0.65);}}
        }
        { const sp=Math.hypot(v[0],v[2]); ringFlow.current+=(THREE.MathUtils.smoothstep(sp,0.5,3.5)-ringFlow.current)*Math.min(1,dt*4); const rg = ringRef.current as unknown as THREE.Group; if (rg) { const surfaceY=waterSurfaceAt(p[0],p[2],sim.t), on = sim.swim && p[1] > surfaceY - 1.6; rg.visible = on; if (on) { const wy = waterRenderY(p[0], p[2], sim.t); rg.position.set(p[0] - Math.sin(sim.ang) * 0.9, wy + 0.04, p[2] - Math.cos(sim.ang) * 0.9); rg.children.forEach((c, i) => { const ph = (sim.t * 0.7 + i / 3) % 1, m = c as THREE.Mesh; m.scale.setScalar(1.0 + ph * 5.5); (m.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - 0.70 * ringFlow.current) * (1 - ph) * (1 - ph); }); } } }   // waterline cue: expanding foam ring where the body cuts the surface
        const sa0 = sim as any;
        const rootPose = applyHeroRootPose(sim, rig, dt, sa0, p, HERO_SC);
        const lean = rootPose.lean, shadowBody = rig.poseRoot.children[0] as THREE.Object3D;
        const shadowAnimation = animateHeroBones(sim, rig, dt, { clipState: clipSt.current, poseState: poseSt.current, glideBlend: rootPose.glideBlend, publishState: true });
        if (DBG) { (window as any).__shadowAnimation = shadowAnimation; (window as any).__shadowSwimOrientation = { wrapperPitch: rig.poseRoot.rotation.x, bodyPitch: shadowBody.rotation.x, rootYaw: h.rotation.y, simYaw: sim.ang, lean, clipWeight: clipSt.current.w }; }
        if (!sim.swim && sim.ground && !wl && (clipSt.current.key === 'run' || clipSt.current.key === 'idle')) {   // plant the lowest foot vertex on the street (measured from the skinned mesh, replaces the fixed run drop)
            h.updateMatrixWorld(true);
            let mn = 1e9;
            for (const e of rig.hull) { if (!e.foot) continue; tp0.set(0, 0, 0); for (let k = 0; k < 4; k++) { if (e.bw[k] <= 0) continue; _wv2.copy(e.p).applyMatrix4(rig.skel.boneInverses[e.bi[k]]).applyMatrix4(rig.skel.bones[e.bi[k]].matrixWorld); tp0.addScaledVector(_wv2, e.bw[k]); } if (tp0.y < mn) mn = tp0.y; }
            {   // plant from the lowest foot point seen over the clip cycle (stance), so the airborne phase of the stride is kept; smoothed, not per frame
                const gm = groundMin.current, ck2 = clipSt.current.key;
                const gBd = ((sim as any).gB || 0) > 0.03;   // glide body shift distorts foot heights: don't collect while it decays, re-collect fresh after
                if (gBd) gm.key = '';
                const fresh = gm.key !== ck2;
                if (fresh) { gm.key = ck2; gm.v = 1e9; }
                if (!gBd && mn < gm.v) gm.v = mn;
                const wg = gm.v > 1e8 ? groundCorr.current : Math.max(-0.4, Math.min(0.4, 0.02 + (sim.pos[1] - 1.0) - gm.v));
                if (fresh && !gBd) groundCorr.current = wg; else groundCorr.current += (wg - groundCorr.current) * Math.min(1, dt * 8);
            }
            if (DBG && (window as any).__dbgGround) (window as any).__gc = { mn, corr: groundCorr.current };
        } else { groundMin.current.key = ''; groundCorr.current += (0 - groundCorr.current) * Math.min(1, dt * 10); }
        h.position.y += groundCorr.current;
        if (!sim.swim && sim.ground && !wl) {   // Guard the skinned contact hull (including hands/feet) against the actual street, valley or rooftop support. Raise only.
            h.updateMatrixWorld(true);
            let mn2 = 1e9;
            for (const e of rig.hull) { tp0.set(0, 0, 0); for (let k = 0; k < 4; k++) { if (e.bw[k] <= 0) continue; _wv2.copy(e.p).applyMatrix4(rig.skel.boneInverses[e.bi[k]]).applyMatrix4(rig.skel.bones[e.bi[k]].matrixWorld); tp0.addScaledVector(_wv2, e.bw[k]); } if (tp0.y < mn2) mn2 = tp0.y; }
            { const gr = sim.pos[1] - 1.0; if (mn2 < gr + 0.02) h.position.y += gr + 0.02 - mn2; }
            if (DBG && (window as any).__dbgGround) (window as any).__gc2 = mn2 < 0.0 ? 0.02 : mn2;
        }
        if (sim.wall && sim.wallB >= 0) lastWall.current = { n: [sim.wall[0], sim.wall[1]], b: sim.wallB };
        const wnX = sim.wall ? sim.wall : (sim.wallT > 0 && lastWall.current ? lastWall.current.n : null), wbX = sim.wall ? sim.wallB : (lastWall.current ? lastWall.current.b : -1);   // after a wall jump keep the push-out against the wall just left
        if (wnX && wbX >= 0) {   // keep the whole skinned body (head, hands, feet) at the facade: shift along the wall normal by the deepest extreme point
            const bd = buildings[wbX], n = wnX as number[], fx = -n[0], fz = -n[1];
            const pl = fx !== 0 ? (n[0] < 0 ? bd.x0 : bd.x1) : (n[1] < 0 ? bd.z0 : bd.z1), tp = _wv;
            h.updateMatrixWorld(true);
            let md = -1e9;
            for (const e of rig.hull) { tp.set(0, 0, 0); for (let k = 0; k < 4; k++) { if (e.bw[k] <= 0) continue; _wv2.copy(e.p).applyMatrix4(rig.skel.boneInverses[e.bi[k]]).applyMatrix4(rig.skel.bones[e.bi[k]].matrixWorld); tp.addScaledVector(_wv2, e.bw[k]); } const dd = fx !== 0 ? (tp.x - pl) * fx : (tp.z - pl) * fz; if (dd > md) md = dd; }
            const want = Math.max(-1.2, Math.min(1.2, -(md + 0.03)));
            if (want < wallCorr.current) wallCorr.current = want; else wallCorr.current += (want - wallCorr.current) * Math.min(1, dt * 14);   // push out instantly, ease back in
        } else wallCorr.current += (0 - wallCorr.current) * Math.min(1, dt * (sim.wallT > 0 ? 3 : 10));   // after a wall jump keep the push-out until the exit velocity clears the hull
        if (Math.abs(wallCorr.current) > 1e-4 && wnX) { const n = wnX; h.position.x -= n[0] * wallCorr.current; h.position.z -= n[1] * wallCorr.current; }
        { const gp = DBG ? (window as any).__game : null; if (gp && gp.probe) { h.updateMatrixWorld(true); const m = rig.poseRoot.children[0] as THREE.SkinnedMesh; m.skeleton.update(); const pa = m.geometry.attributes.position, si = m.geometry.attributes.skinIndex, swt = m.geometry.attributes.skinWeight, hv = new THREE.Vector3(); const grp = (n: string) => /^head|^neck/.test(n) ? 'head' : /^hand/.test(n) ? 'hands' : /^foot/.test(n) ? 'feet' : 'body'; const parts: Record<string, number[]> = {}; for (let i = 0; i < pa.count; i++) { let bi = si.getX(i), bw = swt.getX(i); for (let k = 1; k < 4; k++) { const w2 = swt.getComponent(i, k); if (w2 > bw) { bw = w2; bi = si.getComponent(i, k); } } const gname = grp(m.skeleton.bones[bi].name); const P = parts[gname] || (parts[gname] = [1e9, -1e9, 1e9, -1e9]); m.getVertexPosition(i, hv); hv.applyMatrix4(m.matrixWorld); P[0] = Math.min(P[0], hv.x); P[1] = Math.max(P[1], hv.x); P[2] = Math.min(P[2], hv.z); P[3] = Math.max(P[3], hv.z); } gp.parts = parts; } }
        cape.current.rotation.x = 0.25 + Math.min(1.0, speed / 38) + Math.sin(sim.t * 14) * 0.05 * Math.min(1, speed / 20);
        { // hidden cape chain: trail back with speed, flare and flutter in the glide
            const c1 = rig.b.cape1, c2 = rig.b.cape2, c3 = rig.b.cape3;
            if (c1) {
                const sp = Math.min(1, speed / 30), gl = sim.glideOn ? 1 : 0, ph = sim.t * (gl ? 9 : 6);
                const tx = gl ? 0.0   /* glide: cape lies back along the body (was 0.55, which stood the cape up behind the neck) */ : sp * 0.35, fl = gl ? 0.12 : 0.04 * sp;
                const lerp = Math.min(1, dt * 8), cs2: number[] = (sim as any).cpS || ((sim as any).cpS = [0, 0, 0, 0, 0]);   // state kept outside the bones (bones are reset every frame)
                cs2[0] += (tx + Math.sin(ph) * fl - cs2[0]) * lerp;
                cs2[1] += (tx * 0.9 + Math.sin(ph - 0.9) * fl * 1.3 - cs2[1]) * lerp;
                cs2[2] += (tx * 0.7 + Math.sin(ph - 1.8) * fl * 1.6 - cs2[2]) * lerp;
                cs2[3] += (Math.sin(ph * 0.7) * (gl ? 0.2 : 0.05 * sp) - cs2[3]) * lerp;
                cs2[4] += (Math.sin(ph * 0.7 - 1) * (gl ? 0.3 : 0.07 * sp) - cs2[4]) * lerp;
                c1.rotation.x = cs2[0]; c2.rotation.x = cs2[1]; c3.rotation.x = cs2[2]; c2.rotation.z = cs2[3]; c3.rotation.z = cs2[4];
            }
        }
        if ((sim as any).snareT > SNARE.IMPACT || (sim as any).cWeb) { const sa = sim as any; if (!sa.handW) sa.handW = [[0, 0, 0], [0, 0, 0]]; h.updateMatrixWorld(true); [rig.b.handL, rig.b.handR].forEach((b: any, i: number) => { b.getWorldPosition(_hp); sa.handW[i][0] = _hp.x; sa.handW[i][1] = _hp.y; sa.handW[i][2] = _hp.z; }); }
        // web
        { // two web lines, each from an actual animated hand (world position), shot out to the anchor over ~0.14 s
            const wl2 = web.current, wr2 = webB.current, side = sim.swings % 2; // swing: alternate hands (odd = right); spring-shot jump and web-shot attack: both hands together
            const mode = sim.spring > 0 ? 1 : sim.web ? 0 : -1;   // shot: the plasma bolt is the visual now (was mode 2 hand-to-target cylinders)
            const both = mode > 0;
            wl2.visible = mode >= 0 && (both || side === 0); wr2.visible = mode >= 0 && (both || side === 1);
            if (mode >= 0) {
                rig.root.updateWorldMatrix(true, true);
                const tgt = sim.anchor;
                const grow = mode === 1 ? Math.max(0.05, sim.spring / 0.4) : Math.min(1, Math.max(0.05, sim.webT / 0.14));
                const ws = [wl2, wr2], hb = [rig.b.handL, rig.b.handR], fb = [rig.b.farmL, rig.b.farmR];
                for (let i = both ? 0 : side; i <= (both ? 1 : side); i++) {
                    hb[i].getWorldPosition(_hp); fb[i].getWorldPosition(_fp); _hp.addScaledVector(_wd2.copy(_hp).sub(_fp).normalize(), 0.08);
                    const dx = tgt[0] - _hp.x, dy = tgt[1] - _hp.y, dz = tgt[2] - _hp.z, l = Math.hypot(dx, dy, dz) || 1, ll = l * grow;
                    ws[i].position.set(_hp.x + dx / l * ll / 2, _hp.y + dy / l * ll / 2, _hp.z + dz / l * ll / 2);
                    ws[i].quaternion.setFromUnitVectors(Y, _wd2.set(dx / l, dy / l, dz / l));
                    ws[i].scale.set(1, ll, 1);
                    if (DBG) { (window as any)['__webO' + i] = [_hp.x, _hp.y, _hp.z]; (window as any).__webMode = mode; }
                }
            }
        }
        { const bm = beaconRef.current; bm.position.set(sim.beacon[0], sim.beacon[1] + 45, sim.beacon[2]); bm.scale.set(1 + 0.08 * Math.sin(sim.t * 3), 1, 1 + 0.08 * Math.sin(sim.t * 3)); }
        { // edge-aware beacon marker (DOM, no React state)
            const el = document.getElementById('bmark');
            if (el) {
                bv.set(sim.beacon[0], sim.beacon[1] + 6, sim.beacon[2]);
                camera.updateMatrixWorld();
                bv2.copy(bv).applyMatrix4(camera.matrixWorldInverse);
                const behind = bv2.z > -0.1; // camera looks down -z in view space
                let x: number, y: number;
                if (behind) { const l = Math.hypot(bv2.x, bv2.y); if (l < 0.01) { x = 0; y = -1; } else { x = bv2.x / l; y = bv2.y / l; } }
                else { bv.project(camera); x = bv.x; y = bv.y; }
                const m = Math.max(Math.abs(x) / 0.82, Math.abs(y) / 0.8, 1);
                const onScreen = !behind && m <= 1;
                x = x / (onScreen ? 1 : m); y = y / (onScreen ? 1 : m);
                el.style.transform = 'translate(' + (((x + 1) / 2) * window.innerWidth - 20).toFixed(0) + 'px,' + (((1 - y) / 2) * window.innerHeight - 20).toFixed(0) + 'px) rotate(' + (onScreen ? 180 : Math.atan2(-y, x) * 57.3 + 90).toFixed(0) + 'deg)';
                el.style.opacity = sim.mode === 'play' ? '1' : '0';
            }
        }
        { // enemies (instanced, one mesh per bot kind)
            enemyTime.current.value = sim.t; const n = sim.enemies.length, cnt = [0, 0, 0, 0];
            for (let i = 0; i < n; i++) {
                const e = sim.enemies[i]; if (e.boss) continue; const k = e.kind || 0, m = enMeshes.current[k]; if (!m) continue;
                const fall = e.down > 0 ? Math.min(1, (3 - e.down) * 5) : 0, bob = k >= 2 ? Math.sin(sim.t * 2.5 + i) * 0.12 : 0;
                const ea = e as any, ly = ea.ly || 0, lean = e.down > 0 ? 0 : Math.min(1, e.hit / 0.35) * (ea.hitDir >= 3 ? 0.55 : 0.32), tum = ly > 0.05 ? Math.sin(Math.min(1, ly / 3) * 1.57) * (ea.slam ? -1.1 : 0.9) : 0;
                tmp.position.set(e.x, e.y + 0.06 - fall * 0.6 + bob + ly, e.z); tmp.rotation.set(fall * -1.4 - lean - tum, e.ang, 0); { const bi = e.born === undefined ? 1 : Math.min(1, Math.max(0, (sim.t - e.born) / 0.6)), fo = e.down > 0 ? Math.min(1, e.down / 0.5) : 1, sc = (e.kind === 3 ? BOT_SC : 1.25) * Math.max(0.001, bi * bi * (3 - 2 * bi)) * Math.max(0.001, fo); tmp.scale.set(sc, sc, sc); }   // new or re-placed enemies grow in, KO'd ones shrink out, so nothing pops
                tmp.updateMatrix();
                m.setMatrixAt(cnt[k], tmp.matrix);
                if (e.hit > 0) ecol.setRGB(2.6, 2.6, 2.6); else if (e.atk > 0) ecol.setRGB(1.8, 0.5 + Math.sin(sim.t * 30) * 0.2, 0.4); else ecol.setRGB(1, 1, 1);
                m.setColorAt(cnt[k], ecol); cnt[k]++;
            }
            for (let k = 0; k < 4; k++) { const m = enMeshes.current[k]; if (!m) continue; m.count = cnt[k]; syncInk(m); m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
        }
        // orbs
        const t = sim.t;
        let nb = -1, nd = 1e9;
        for (let i = 0; i < sim.orbs.length; i++) {
            const o = sim.orbs[i], by = o[1] + Math.sin(t * 2 + o[0]) * 0.6;
            tmp.position.set(o[0], by, o[2]); tmp.rotation.set(t * 1.2, t * 1.5, 0); tmp.scale.setScalar(1); tmp.updateMatrix();
            cores.current.setMatrixAt(i, tmp.matrix);
            tmp.rotation.set(0, 0, 0); tmp.scale.setScalar(1 + 0.12 * Math.sin(t * 5 + i)); tmp.updateMatrix(); glows.current.setMatrixAt(i, tmp.matrix);
            const d = Math.hypot(o[0] - p[0], o[1] - p[1], o[2] - p[2]); if (d < nd) { nd = d; nb = i; }
        }
        cores.current.instanceMatrix.needsUpdate = true; glows.current.instanceMatrix.needsUpdate = true;
        arrow.current.visible = false;   // user 10:01 "Remove navigator arrows"
        if (nb >= 0) {
            const o = sim.orbs[nb], a = Math.atan2(o[0] - p[0], o[2] - p[2]);
            arrow.current.position.set(p[0] + Math.sin(a) * 3, p[1] + 3.2, p[2] + Math.cos(a) * 3);
            arrow.current.rotation.set(Math.PI / 2, 0, 0); arrow.current.rotation.order = 'YXZ'; arrow.current.rotation.y = a;
        }
    });

    return <>
        <mesh ref={beaconRef} onUpdate={(o) => o.layers.enable(SELECTIVE_BLOOM_LAYER)} frustumCulled={false}><cylinderGeometry args={[4, 4, 90, 12, 1, true]} /><meshBasicMaterial color="#5ff2ff" transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} fog={false} /></mesh>
        <color attach="background" args={[FOG[0], FOG[1], FOG[2]]} />
        <hemisphereLight name="hemi" args={['#d4e4ff', '#8a9a6a', 1.25]} />
        <directionalLight name="sun1" position={[-30, 60, 20]} intensity={1.8} color="#ffdcae" />
        <directionalLight name="sun2" position={[20, 30, -40]} intensity={0.8} color="#a8caff" />
        <DayNight />
        <DebugStats />
        {OUTLINE_STATE.on ? <OutlinePass /> : <FxaaPass enabled={AA_FXAA} />}
        <SelectiveBloomPass />
        {OUTLINE_STATE.on && HD.enabled ? <HeroHDPass /> : null}
        <Sky />
        <RoofProps harborOnly />
        <CityGate><City /><TenementBlock />
        <ParkGround />
        <React.Suspense fallback={null}>
            <PolyforkBuildings />
            <FarPropGate><RoofProps />
            <StreetProps tod={TOD} /></FarPropGate>
            <PolyforkLakeBridge sim={sim} perf={perf} tod={TOD} />
        </React.Suspense></CityGate>
        <FlyingCars sim={sim} />
        {/* Rebuild park and city trees with authored forms and foliage; never overlay Polyfork tree canopies. */}
        <CityGate><Forest sim={sim} renderGround={false} />
        <Meadow sim={sim} /></CityGate><WindLines sim={sim} /><Civilians sim={sim} /><SnareLines sim={sim} /><Underwater sim={sim} /><PlasmaFx sim={sim} /><EnemyDeathFx sim={sim} /><EnemyShotsFx sim={sim} />
        <primitive object={rig.root} ref={hero} />
        <BossArenaMarker />
        <BossArenaMarker arena={HBOSS} />
        <GiantBoss sim={sim} />
        <GiantBoss sim={sim} mini />
        <mesh ref={web} visible={false}><cylinderGeometry args={[0.035, 0.035, 1, 5]} /><meshBasicMaterial color="#f4f4ff" /></mesh>
        <mesh ref={webB} visible={false}><cylinderGeometry args={[0.035, 0.035, 1, 5]} /><meshBasicMaterial color="#f4f4ff" /></mesh>
        <mesh ref={arrow}><coneGeometry args={[0.35, 1.1, 8]} /><meshBasicMaterial color="#ffd54a" /></mesh>
        <mesh ref={wakeRef} geometry={wakeGeo} material={wakeMat} visible={false} frustumCulled={false} />
        <group ref={splashRef} visible={false}>{[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => <mesh key={i} frustumCulled={false}><coneGeometry args={[0.13, 1, 5]} /><meshBasicMaterial color="#f4fdff" transparent opacity={0.9} depthWrite={false} /></mesh>)}</group>
        <group ref={ringRef as any} visible={false}>{[0, 1, 2].map((i) => <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false}><ringGeometry args={[1.0, 1.09, 48]} /><meshBasicMaterial color="#eefbff" transparent opacity={0.4} depthWrite={false} /></mesh>)}</group>
        <mesh position={[0, WATER_Y, WATER_Z - 400]} ref={waterRef} material={waterMat} frustumCulled={false} geometry={OCEAN_GEO} />
        <OceanFollow waterRef={waterRef} />
        <Boats sim={sim} /><Gulls sim={sim} /><Fish sim={sim} /><Whale sim={sim} /><MarineSnow />
        <SouthSea sim={sim} kit={SOUTH_SEA_KIT} />
        {/* Shifat 9:33 AM 'No reflection. Lock it. Remove any second render.': OceanScreenSpace (scene copy) and the reflection probe are not mounted */}
        <mesh geometry={SEABED_GEO} frustumCulled={false}><primitive object={seabedMat} attach="material" /></mesh>
        <mesh position={[0, (SEABED) / 2, WATER_Z - 0.3]}><boxGeometry args={[2 * HALF, -SEABED, 0.6]} /><primitive object={wallMat} attach="material" /></mesh>
        {/* the 200 m wall extensions past the city run along open sea: top kept 0.4 m under the still-water line (at 0 m it read as a dark line on the horizon from the island) */}
        {[-1, 1].map((s) => <mesh key={s} position={[s * (HALF + 100), (SEABED + WATER_Y - 0.4) / 2, WATER_Z - 0.3]}><boxGeometry args={[200, WATER_Y - 0.4 - SEABED, 0.6]} /><primitive object={wallMat} attach="material" /></mesh>)}
        {enemySet.map((p, k) => <instancedMesh key={k} ref={(r) => { if (r && enMeshes.current[k] !== r) { enMeshes.current[k] = r; attachInk(r); } }} args={[p.geo, p.mat, 48]} frustumCulled={false} />)}
        <instancedMesh ref={cores} onUpdate={(o) => o.layers.enable(SELECTIVE_BLOOM_LAYER)} args={[undefined, undefined, 18]} frustumCulled={false}><icosahedronGeometry args={[1.3, 1]} /><meshBasicMaterial color="#ffd23f" transparent opacity={0.5} blending={THREE.NoBlending} /></instancedMesh>
        <instancedMesh ref={glows} onUpdate={(o) => o.layers.enable(SELECTIVE_BLOOM_LAYER)} args={[undefined, undefined, 18]} frustumCulled={false}><sphereGeometry args={[3.0, 10, 8]} /><meshBasicMaterial color="#ffb347" transparent opacity={0.22} blending={THREE.AdditiveBlending} depthWrite={false} /></instancedMesh>
    </>;
}
export { gsap, resetSim };

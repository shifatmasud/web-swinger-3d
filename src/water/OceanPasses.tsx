import { waveH } from './waveHeight';
import React, { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { WATER_Y, WATER_Z, SEABED, HALF, SEA, type Sim } from '../sim';
import { QUALITY, QK, LOWQ } from '../quality';
import { ISLAND } from '../seaWorld';
import { HERO_REFL } from '../caustics';
import { worldBufferSize } from '../heroHD';
import { UW } from '../world/env';
import { OCEAN_SNAP } from './seabed';
import { waterMat } from './oceanMaterial';
import { projectSkyline } from './skylineRefl';

// Per-frame drivers of the sea: the camera-following sheet, the mirror (reflection) pass and the screen-space scene copy for refraction.
const DBG = !!(import.meta as any).env.VITE_DBG;   // test hooks only in instrumented builds

export function OceanFollow({ waterRef }: { waterRef: React.MutableRefObject<THREE.Mesh | null> }) {
    useFrame(({ camera }) => { const w = waterRef.current; if (!w) return; const so = DBG ? ((window as any).__seaSnapOff || 0) : 0; w.position.set(Math.round(camera.position.x / OCEAN_SNAP) * OCEAN_SNAP + so, WATER_Y, Math.round(camera.position.z / OCEAN_SNAP) * OCEAN_SNAP + so); });   /* __seaSnapOff: sea sim test hook (shifts the sheet by whole snaps; a correct sea renders identically) */
    return null;
}

// Ocean screen-space copy (same technique as the park lake): a low-res colour+depth copy of the scene without the sea, taken only
// while the sea is on screen and near enough to matter; skipped when the frame budget is tight.
const _oceanBox = new THREE.Box3(new THREE.Vector3(-HALF - 700, SEABED - 45, SEA.zMin - 600), new THREE.Vector3(HALF + 700, WATER_Y + 4, WATER_Z + 2));
// Shifat 2:58 AM "reflection when?": real mirrored reflections of the island (terrain, palms, trees, rocks, lighthouse, shacks, dock) in the sea.
// A Reflector-style virtual camera mirrored about the sea plane renders ONLY those opaque shapes (layer 7, ~15 draw calls, no grass/water/fx)
// into a small target (1/4 res desktop, 1/5 phone; phones every 2nd frame); the ocean shader samples it with wave distortion and Fresnel.
const REFL_LAYER = 7;
const NOPROBE = typeof location !== 'undefined' && /[?&]debug/.test(location.search) && /[?&]noprobe/.test(location.search);   // ?debug&noprobe: A/B test on device
const NOCOPY = typeof location !== 'undefined' && /[?&]debug/.test(location.search) && /[?&]nocopy/.test(location.search);   // ?debug&nocopy: only the scene copy off
export function IslandReflection({ waterRef, sim, perf }: { waterRef: React.MutableRefObject<THREE.Mesh | null>; sim: Sim; perf: { scale: number } }) {
    const { gl, scene, camera } = useThree();
    const st = useMemo(() => ({ n: 0, tagged: false, plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y + 0.05),
        probe: { cam: null as any, rt: [] as THREE.WebGLCubeRenderTarget[], cur: 0, face: -1, at: new THREE.Vector3(1e9, 0, 0), pos: new THREE.Vector3(), last: 0, ready: false }, col: new THREE.Color(), pv: new THREE.Matrix4(), fr: new THREE.Frustum() }), []);
    useEffect(() => () => { st.probe.rt.forEach((r) => r.dispose()); }, [st]);
    useFrame(() => {
        const u = waterMat.uniforms, cam = camera as THREE.PerspectiveCamera, w = waterRef.current;
        HERO_REFL.shadow.set(sim.pos[0], sim.pos[1], sim.pos[2], sim.mode === 'play' ? 1 : 0); u.uHeroA.value.copy(HERO_REFL.shadow); u.uHeroB.value.copy(HERO_REFL.ghost); HERO_REFL.shadowDir.set(Math.sin(sim.yaw), 0, Math.cos(sim.yaw), sim.swim && !sim.dive ? 1 : 0); u.uHeroDA.value.copy(HERO_REFL.shadowDir);   // analytic hero reflections (everywhere on the sea)
        { const t = u.uTime.value, a = HERO_REFL.shadow, b = HERO_REFL.ghost; u.uHw.value.set(waveH(a.x, a.z, t), waveH(b.x, b.z, t), waveH(cam.position.x, cam.position.z, t)); }   /* Shifat 4:28 AM (hiding the sea gave the biggest fps jump): these 3 wave heights are the same for every vertex, so they are computed once here instead of 3x per sea vertex */
        const d = Math.hypot(cam.position.x - ISLAND.cx, cam.position.z - ISLAND.cz);
        // Shifat 3:39 AM "cities & bridges must reflect on water too": the mirror pass now runs near the island, along the city shore, and around the
        // east bridge / harbor; it replaces the screen-space march there (which could never show what is off-screen, like the tops of towers).
        const zone = d < 520 || cam.position.z > WATER_Z - 320 || (cam.position.x > -40 && cam.position.z < -760);
        st.pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); st.fr.setFromProjectionMatrix(st.pv);
        const ok = !!w && zone && cam.position.z < WATER_Z + 40 && cam.position.y > WATER_Y + 0.3 && cam.position.y < 110 && !(UW as any).on && st.fr.intersectsBox(_oceanBox);   /* only when the sea is actually in view */
        if (!ok || NOPROBE) { u.uUseRefl.value = 0; return; }
        if (!st.tagged || st.n % 3600 === 0) {   /* was every 300 frames: a whole-scene walk on the CPU */   // (re)tag big opaque shapes - island, city blocks, bridges, harbor - plus lights (three culls lights by layer too)
            const sp = new THREE.Sphere(); let nT = 0;
            scene.traverse((o: any) => { if (o.isLight) { o.layers.enable(REFL_LAYER); return; } if (!o.isMesh || o.isPoints || o.isSkinnedMesh || o.layers.isEnabled(REFL_LAYER)) return;
                const m = Array.isArray(o.material) ? o.material[0] : o.material; if (!m || m.transparent || !m.depthTest || o === w || o.userData.noRefl || (o.isInstancedMesh && o.count > 3000)) return;   /* custom-shader city/blocks included; water, sky, fx excluded */
                const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); if (o.isInstancedMesh && g.boundingSphere!.radius < 1.2) return;   /* grass blades, flowers, small street props: sub-pixel in the low-res rippled mirror, so not re-drawn there */ sp.copy(g.boundingSphere!).applyMatrix4(o.matrixWorld); if (!o.isInstancedMesh && (sp.radius < 3.5 || sp.radius > 3000 || sp.center.y + sp.radius < WATER_Y + 0.5)) return; o.layers.enable(REFL_LAYER); nT++; });
            if (DBG) (window as any).__reflTagged = ((window as any).__reflTagged || 0) + nT;
            st.tagged = true;
        }
        st.n++;
        // Shifat 4:30 PM 'what if we used cheap techniques?': a REFLECTION PROBE instead of the planar mirror. A small cubemap of the tagged big shapes
        // (island, city, bridge, harbor) is captured at water level under the camera, ONE face per frame and only when the camera has moved > 40 m
        // (or every ~8 s for the day/night change); otherwise nothing is re-rendered at all. The sea samples it along the rippled reflection ray with a
        // mip bias, which gives the soft, blurry, subtle look for free. Double-buffered so a half-updated probe is never shown. Same on every device.
        const P = st.probe;
        if (!P.cam) {
            const mk = () => new THREE.WebGLCubeRenderTarget(64, { type: rtType(gl), generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
            P.rt = [mk(), mk()]; P.cam = new THREE.CubeCamera(1, 2500, P.rt[0]);   /* far enough for the whole skyline from the open sea */ P.cam.coordinateSystem = gl.coordinateSystem; P.cam.updateCoordinateSystem(); P.cam.children.forEach((c: any) => c.layers.set(REFL_LAYER));
        }
        /* Shifat 9:06 AM 'reflection probe causing the ocean snap & re-draw': the probe re-captured (6 scene renders + mip build) every time the camera moved 40 m and
           then swapped in at once = a visible snap of the reflections plus frame spikes. Now it is captured ONCE from a fixed point on the sea (super blurry
           reflections don't need the exact viewpoint) and only refreshed every ~2 min for the day/night light; nothing re-renders while flying. */
        if (P.face < 0 && (!P.ready || st.n - P.last > 3600)) { P.face = 0; P.pos.set(0, WATER_Y + 0.5, -560); }
        if (P.face >= 0 && st.n % 4 === 0) {   /* one face every 4th frame (was 2nd): halves the per-frame cost while flying, refresh still < 1 s */   // one face every other frame: the refresh costs ~1/12 of a scene render per frame, and only while it runs
            const back = P.rt[1 - P.cur], f = P.face, fc = P.cam.children[f] as THREE.PerspectiveCamera;
            P.cam.position.copy(P.pos); P.cam.updateMatrixWorld(true);
            const prev = gl.getRenderTarget(), ac = gl.autoClear, sh = gl.shadowMap.autoUpdate, cp = gl.clippingPlanes, cc = gl.getClearAlpha(); gl.getClearColor(st.col);
            back.texture.generateMipmaps = f === 5;
            try { gl.shadowMap.autoUpdate = false; gl.autoClear = true; gl.clippingPlanes = [st.plane]; gl.setClearColor(st.col, 0); gl.setRenderTarget(back, f); gl.clear(true, true, true); if (f !== 3) gl.render(scene, fc); }   /* Shifat 6:56 PM 'flying near water fps spikes': the -Y face looks under the water plane (clip leaves it empty) - cleared, never drawn */
            finally { gl.setRenderTarget(prev); gl.autoClear = ac; gl.shadowMap.autoUpdate = sh; gl.clippingPlanes = cp; gl.setClearColor(st.col, cc); }
            if (++P.face > 5) { P.face = -1; P.cur = 1 - P.cur; P.at.copy(P.pos); P.last = st.n; P.ready = true; }
        }
        if (!P.ready) { u.uUseRefl.value = 0; return; }
        u.tProbe.value = P.rt[P.cur].texture; u.uUseRefl.value = 1;
        if (DBG) (window as any).__refl = { n: st.n, probe: st.probe.cur, ready: st.probe.ready };
    });
    return null;
}
const PHONE_REFL = QUALITY.coarse || LOWQ;
// Phone GPUs (Adreno 506 etc.) often cannot RENDER into half-float targets (no EXT_color_buffer_half_float / _float): the copy came out empty, so on
// Shifat's phone no reflections showed at all. Use half float only when the GPU can render to it, else plain 8-bit.
function rtType(gl: THREE.WebGLRenderer) { const e = gl.extensions; return (e.has('EXT_color_buffer_float') || e.has('EXT_color_buffer_half_float')) && !(QUALITY.coarse || LOWQ) ? THREE.HalfFloatType : THREE.UnsignedByteType; }
export function OceanScreenSpace({ sim, waterRef, perf }: { sim: Sim; waterRef: React.MutableRefObject<THREE.Mesh | null>; perf: { scale: number } }) {
    const { gl, scene, camera } = useThree();
    const target = useMemo(() => { const t = new THREE.WebGLRenderTarget(4, 4, { type: rtType(gl) }); t.depthTexture = new THREE.DepthTexture(4, 4); t.depthTexture.type = THREE.UnsignedIntType; return t; }, []);
    const st = useMemo(() => ({ fr: new THREE.Frustum(), pv: new THREE.Matrix4(), buf: new THREE.Vector2(), n: 0, copies: 0 }), []);
    useEffect(() => () => target.dispose(), [target]);
    useFrame(() => {
        const u = waterMat.uniforms, cam = camera as THREE.PerspectiveCamera, w = waterRef.current;
        u.uProj.value.copy(cam.projectionMatrix); u.uNear.value = cam.near; u.uFar.value = cam.far; u.uSteps.value = QK.lakeSteps;
        st.pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); st.fr.setFromProjectionMatrix(st.pv);
        const near = cam.position.z < WATER_Z + 170 && cam.position.y > WATER_Y - 0.5 && cam.position.y < 140, scale = perf.scale;
        const phoneFar = PHONE_REFL;   /* Shifat 9:26 AM (6 fps at sea, 237 draw calls, whitewashed jittery bridge mirror): phones never run this second whole-scene render now - the bed is analytic, the probe gives the soft reflection */   /* Shifat 9:16 AM phone fps: the copy is a second full scene render; out at sea the bed is analytic and near water is see-through, so phones skip it there */
        const ok = !!w && near && !phoneFar && !NOPROBE && !NOCOPY && st.fr.intersectsBox(_oceanBox) && scale > 0.5 && !(UW as any).on;   /* ?debug&noprobe also stops this second scene render (the screen-space reflection + refraction copy) */
        if (!ok) { u.uUseScene.value = 0; return; }
        st.n++;
        const farSea = cam.position.z < WATER_Z - 320;
        if ((scale > 0.6 && !PHONE_REFL && !farSea) || st.n % (PHONE_REFL ? 3 : 2) === 0 || st.copies === 0) {   /* phones: 1/3 rate (Shifat 6:56 PM spikes near water) */   /* phones always, desktop out at open sea (Shifat 10:27 'go alternative'): half rate - one frame of lag under rippled water is invisible */
            worldBufferSize(gl, st.buf);
            const W = Math.max(160, Math.round(st.buf.x * QK.lakeCopyScale)), H = Math.max(90, Math.round(st.buf.y * QK.lakeCopyScale));
            if (target.width !== W || target.height !== H) target.setSize(W, H); u.uSceneTx.value.set(1 / W, 1 / H);
            const prev = gl.getRenderTarget(), ac = gl.autoClear, sh = gl.shadowMap.autoUpdate;
            try { w!.visible = false; gl.shadowMap.autoUpdate = false; gl.autoClear = true; gl.setRenderTarget(target); gl.clear(true, true, true); gl.render(scene, camera); }
            finally { gl.setRenderTarget(prev); gl.autoClear = ac; gl.shadowMap.autoUpdate = sh; w!.visible = true; }
            st.copies++;
        }
        u.tScene.value = target.texture; u.tDepth.value = target.depthTexture; u.uUseScene.value = 1;
        if (DBG) (window as any).__ocean = { copies: st.copies, on: 1 };
    });
    return null;
}

/* Reflection illusion driver + hero uniforms (the hero refraction / see-through / clear-pocket code in the sea reads uHeroA/B every frame;
   they were only fed by the unmounted probe pass). The skyline ring is re-projected when the camera moves ~30 m; nothing is rendered. */
export function ReflectionIllusion({ sim }: { sim: Sim }) {
    const { camera } = useThree();
    const st = useMemo(() => ({ at: new THREE.Vector3(1e9, 0, 0) }), []);
    useFrame(() => {
        const u = waterMat.uniforms, cam = camera as THREE.PerspectiveCamera;
        HERO_REFL.shadow.set(sim.pos[0], sim.pos[1], sim.pos[2], sim.mode === 'play' ? 1 : 0); u.uHeroA.value.copy(HERO_REFL.shadow); u.uHeroB.value.copy(HERO_REFL.ghost); HERO_REFL.shadowDir.set(Math.sin(sim.yaw), 0, Math.cos(sim.yaw), sim.swim && !sim.dive ? 1 : 0); u.uHeroDA.value.copy(HERO_REFL.shadowDir);
        { const t = u.uTime.value, a = HERO_REFL.shadow, b = HERO_REFL.ghost; u.uHw.value.set(waveH(a.x, a.z, t), waveH(b.x, b.z, t), waveH(cam.position.x, cam.position.z, t)); }
        const ok = cam.position.z < WATER_Z + 40 && cam.position.y > WATER_Y + 0.3 && cam.position.y < 160 && !(UW as any).on;
        if (!ok) { u.uUseRefl.value = 0; return; }
        if (Math.hypot(cam.position.x - st.at.x, cam.position.z - st.at.z) > 30) { st.at.copy(cam.position); projectSkyline(cam.position.x, cam.position.z); }
        u.uUseRefl.value = 1;
    });
    return null;
}

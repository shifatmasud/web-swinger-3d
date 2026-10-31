import { SKYLINE_TEX } from './skylineRefl';
import * as THREE from 'three';
import { seabedAt } from '../sim';
import { islandH } from '../seaWorld';
import { QUALITY, LOWQ } from '../quality';
import { CAUSTIC_TEX, WATER_NRM } from '../caustics';
import { TOD, UWF, WATERLINE } from '../world/env';
import { OCEAN_VERT, OCEAN_FRAG } from './oceanShader';

// Shifat 2:07 AM Oct 30 "must implement water transparency & refraction law": a baked bed map (height + sand/rock) around the island so
// the ocean shader can trace each view ray through the surface by Snell's law (n 1.333) to the real seabed and absorb it by path length.
// One 256x256 RGBA8 texture, built once; the shader does 3 fetches (fixed-point ray/bed intersection) instead of a second scene render.
const BED_C = { x: -160, z: -820, h: 260 }, BED_N = 256;
const BED_TEX = (() => {
    const d = new Uint8Array(BED_N * BED_N * 4);
    for (let j = 0; j < BED_N; j++) for (let i = 0; i < BED_N; i++) {
        const x = BED_C.x - BED_C.h + (i + 0.5) / BED_N * 2 * BED_C.h, z = BED_C.z - BED_C.h + (j + 0.5) / BED_N * 2 * BED_C.h;
        const ih = islandH(x, z), y = ih !== null ? ih : seabedAt(x, z), o = (j * BED_N + i) * 4;
        const n1 = Math.sin(x * 0.21 + z * 0.13) * Math.sin(x * 0.07 - z * 0.17);
        d[o] = Math.round(Math.max(0, Math.min(1, (y + 30) / 40)) * 255);                                 // height -30..+10 m
        d[o + 1] = Math.round(Math.max(0, Math.min(1, (y + 16 + n1 * 4) / 9)) * 255);                    // sand (shallow) -> rock/weed (deep)
        d[o + 2] = Math.round((0.5 + 0.5 * n1) * 255); d[o + 3] = 255;
    }
    const t = new THREE.DataTexture(d, BED_N, BED_N, THREE.RGBAFormat); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t;
})();
export const waterMat = new THREE.ShaderMaterial({
    transparent: true, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uUWF: UWF, uWL: { value: WATERLINE.v }, uWLy: { value: WATERLINE.y }, uDay: TOD.day, uSun: TOD.sunU, uSky: { value: TOD.sky }, uDeep: { value: new THREE.Color('#0a6f92') }, uShallow: { value: new THREE.Color('#2fa8c4') },
        // Shifat Oct 29 "ocean water can be upgraded like lake waters": same screen-space reflection + refraction the lake uses (OceanScreenSpace fills these)
        uHw: { value: new THREE.Vector3() }, tScene: { value: null }, tDepth: { value: null }, uBed: { value: BED_TEX }, tProbe: { value: null }, uSkyl: { value: SKYLINE_TEX }, uSceneTx: { value: new THREE.Vector2(0.004, 0.007) }, uFogK: { value: (QUALITY.coarse || LOWQ) ? 0.0042 : 0.0032 }, uBoat: { value: [0, 1, 2, 3, 4].map(() => new THREE.Vector4(0, 1e5, 0, 0)) }, uHeroA: { value: new THREE.Vector4(0, -999, 0, 0) }, uHeroB: { value: new THREE.Vector4(0, -999, 0, 0) }, uHeroDA: { value: new THREE.Vector4(0, 0, 0, 0) }, uUseRefl: { value: 0 }, uCaus: { value: CAUSTIC_TEX }, uNrm: { value: WATER_NRM }, uDet2: { value: (QUALITY.coarse || LOWQ) ? 0 : 1 }, uBedC: { value: new THREE.Vector3(BED_C.x, BED_C.z, BED_C.h) }, uUseScene: { value: 0 }, uSteps: { value: 7 }, uNear: { value: 0.1 }, uFar: { value: 1000 }, uProj: { value: new THREE.Matrix4() } },
    vertexShader: OCEAN_VERT,
    fragmentShader: OCEAN_FRAG,
});

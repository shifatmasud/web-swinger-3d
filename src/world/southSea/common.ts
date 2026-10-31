import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { QUALITY, LOWQ } from '../../quality';

// Shared South Sea helpers: the kit type, phone flag, haze shader, geometry colour/merge utilities and the seeded RNG.
export interface SouthSeaKit {
    tod: { fog: THREE.Color; sky: THREE.Color; sun: THREE.Vector3; day: { value: number } };
    palmGeo: (seed: number) => { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry; lo: THREE.BufferGeometry };
    treeGeo: (kind: 'broad' | 'umbrella' | 'poplar' | 'cherry', seed: number, leafN: number, scaleMul?: number) => { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry };
    palmTrunkTex: () => THREE.Texture; palmFrondTex: () => THREE.Texture;
    palmFrondShader: (sh: any) => void; trunkWindShader: (sh: any) => void; leafWindShader: (sh: any) => void;
    tuftGeo: () => THREE.BufferGeometry; parkBushGeo: () => THREE.BufferGeometry; parkGrassOnCompile: (uni: { uTime: { value: number }; uHero: { value: THREE.Vector3 }; uCam: { value: THREE.Vector3 } }) => (sh: any) => void;
}
export const PHONE = QUALITY.coarse || (QUALITY as any).weakGpu || LOWQ;
export const HAZE_K = { value: 0.0021 };
export const SKY_BLUE = new THREE.Color(0.42, 0.6, 0.78);
// Distance haze toward the day/night fog colour (the city shaders fog much harder; the sea sights use a lighter haze so the
// island and the far city read as silhouettes from the beach). Off underwater, where the scene fog takes over.
export function hazeShader(tod: SouthSeaKit['tod'], inner?: (sh: any) => void) {
    return (sh: any) => {
        inner?.(sh);
        sh.uniforms.uHazeCol = { value: tod.fog }; sh.uniforms.uHazeK = HAZE_K;
        sh.vertexShader = 'varying vec3 vHzW;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 hzp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        hzp = instanceMatrix * hzp;
        #endif
        #ifdef USE_BATCHING
        hzp = batchingMatrix * hzp;
        #endif
        vHzW = (modelMatrix * hzp).xyz; }`);
        sh.fragmentShader = 'varying vec3 vHzW; uniform vec3 uHazeCol; uniform float uHazeK;\n' + sh.fragmentShader.replace('#include <fog_fragment>', `#include <fog_fragment>
        if (cameraPosition.y > -0.6) { float hzd = length(vHzW - cameraPosition); gl_FragColor.rgb = mix(gl_FragColor.rgb, uHazeCol, min(0.93, 1.0 - exp(-hzd * uHazeK))); }`);
    };
}
export const colorize = (g: THREE.BufferGeometry, c: THREE.ColorRepresentation) => { const cc = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };
export const merged = (parts: THREE.BufferGeometry[]) => { const g = mergeGeometries(parts.map((p) => { const q = p.index ? p.toNonIndexed() : p; if (q.attributes.uv) q.deleteAttribute('uv'); if (!q.attributes.normal) q.computeVertexNormals(); return q; }), false)!; return g; };
let _seed = 4242; export const rnd = () => (_seed = (_seed * 16807) % 2147483647) / 2147483647;
export const setSeed = (s: number) => { _seed = s; };   // shared seeded RNG: geometry builders reset it so their layouts never change



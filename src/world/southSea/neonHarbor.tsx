import { AVENUE, HARBOR, HBLOCKS, HBRIDGES, HTOWERS, LIGHTHOUSE } from '../../seaWorld';
import { buildings } from '../../sim';
import * as THREE from 'three';
import React, { useMemo, useRef } from 'react';
import { SELECTIVE_BLOOM_LAYER } from '../../renderLayers';
import { useFrame } from '@react-three/fiber';
import { type SouthSeaKit, PHONE, HAZE_K, hazeShader, colorize, merged, rnd, setSeed } from './common';

// Neon Harbor: tower blocks, platforms, neon trim, signs, stilts, lamps, the far-city impostor and the lamp light shafts.
// ---------------------------------------------------------------- STEP 4: Neon Harbor
const NEON = ['#ff4fd8', '#3ff0ff', '#9b5cff', '#b6ff4a', '#ffb347', '#ff6b8b', '#4dffc3'];
const PASTEL = ['#e79ac4', '#8fc6e6', '#b3a1ea', '#a3d9a0', '#efc28e', '#e6a2b2', '#92ddd0', '#c4c4dc'];   // night facade tint (unchanged: Shifat 'night time is perfect')
const DEEP = ['#9c3f73', '#1f6688', '#4c3c96', '#2d7256', '#a8622a', '#8c3a55', '#1b7670', '#26406a'];   // 2c day facades: richer, darker mid-tones (Shifat 5:58 PM 'washed out in day time')
function harborTowerGeo() {
    const pos: number[] = [], nor: number[] = [], col: number[] = [], dcol: number[] = [], neon: number[] = [], misc: number[] = [], c = new THREE.Color(), cd = new THREE.Color(), n2 = new THREE.Color();
    const face = (a: number[], b: number[], cc: number[], d: number[], n: number[], seed: number, top: number) => { for (const v of [a, b, cc, a, cc, d]) { pos.push(v[0], v[1], v[2]); nor.push(n[0], n[1], n[2]); col.push(c.r, c.g, c.b); dcol.push(cd.r, cd.g, cd.b); neon.push(n2.r, n2.g, n2.b); misc.push(seed, top); } };
    HTOWERS.forEach((t, i) => {
        c.set(PASTEL[i % PASTEL.length]); cd.set(DEEP[i % DEEP.length]); n2.set(NEON[(i * 3) % NEON.length]); if (t.boss) { c.set('#2a2440'); cd.set('#2a2440'); n2.set('#ff2a6d'); }
        const y0 = HARBOR.y, y1 = t.h, { x0, x1, z0, z1 } = t, sd = t.seed + i * 0.013;
        face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], sd, y1);
        face([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], sd, y1);
        face([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], sd, y1);
        face([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], sd, y1);
        face([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], sd, y1);
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aColD', new THREE.Float32BufferAttribute(dcol, 3)); g.setAttribute('aNeon', new THREE.Float32BufferAttribute(neon, 3)); g.setAttribute('aMisc', new THREE.Float32BufferAttribute(misc, 2)); return g;
}
function harborTowerMat(tod: SouthSeaKit['tod']) {
    return new THREE.ShaderMaterial({
        uniforms: { uFog: { value: tod.fog }, uSun: { value: tod.sun }, uDay: tod.day, uT: { value: 0 }, uHazeK: HAZE_K },
        vertexShader: `attribute vec3 aCol; attribute vec3 aColD; attribute vec3 aNeon; attribute vec2 aMisc; varying vec3 vP; varying vec3 vN; varying vec3 vCol; varying vec3 vColD; varying vec3 vNeon; varying vec2 vMisc;
        void main(){ vP = position; vN = normal; vCol = aCol; vColD = aColD; vNeon = aNeon; vMisc = aMisc; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec3 vP; varying vec3 vN; varying vec3 vCol; varying vec3 vColD; varying vec3 vNeon; varying vec2 vMisc; uniform vec3 uFog; uniform vec3 uSun; uniform float uDay; uniform float uT; uniform float uHazeK;
        float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main(){
          vec3 n = normalize(vN); float night = 1.0 - uDay; vec3 L = normalize(uSun + vec3(0.0, 0.3, 0.0)); float dif = max(dot(n, L), 0.0);
          vec3 lit = mix(vec3(0.16, 0.15, 0.3), vec3(0.44, 0.42, 0.5) + vec3(1.0, 0.86, 0.66) * dif * 0.6, uDay);
          vec3 col = mix(vCol, vColD, uDay) * lit;
          float top = vMisc.y, seed = vMisc.x;
          if (n.y < 0.5) {
            float u = (abs(n.x) > 0.5 ? vP.z : vP.x) / 2.4, fy = (vP.y - 8.0) / 3.4; vec2 f = fract(vec2(u, fy)); vec2 id = floor(vec2(u, fy));
            vec2 fw = fwidth(vec2(u, fy)); float aa = clamp(max(fw.x, fw.y) * 1.5, 0.0, 0.5);
            float win = smoothstep(0.16 - aa, 0.16 + aa + 0.001, f.x) * (1.0 - smoothstep(0.84 - aa, 0.84 + aa + 0.001, f.x)) * smoothstep(0.22 - aa, 0.22 + aa + 0.001, f.y) * (1.0 - smoothstep(0.8 - aa, 0.8 + aa + 0.001, f.y)) * step(1.0, fy);
            float h = hash(vec3(id, seed * 97.0)); float on = step(mix(0.75, 0.38, night), h);
            vec3 glassN = mix(vec3(0.16, 0.22, 0.36), vec3(0.55, 0.68, 0.82), 0.4 + 0.3 * n.z) * 0.35;
            vec3 glassD = mix(vec3(0.07, 0.11, 0.19), vec3(0.42, 0.56, 0.72), clamp(0.15 + 0.45 * fract(id.y * 0.37 + id.x * 0.11) + 0.25 * n.z, 0.0, 1.0));   // day glass: dark with sky glints, real contrast
            vec3 glass = mix(glassN, glassD, uDay);
            vec3 lamp = mix(vec3(1.0, 0.82, 0.55), vNeon, step(0.7, hash(vec3(id.yx, seed * 13.0)))) * (0.6 + 0.6 * night);
            col = mix(col, mix(glass, lamp, on * mix(0.25, 1.0, night)), win * (1.0 - smoothstep(0.35, 0.6, max(fw.x, fw.y))));
            float stripe = (1.0 - step(0.12, abs(fract(fy / 6.0 + seed) - 0.5) * 2.0 - 0.0) ) ;   // a neon belt every 6 floors
            float belt = step(0.94, fract(fy / 6.0 + seed)) + step(top - 0.9, vP.y);   // belts + the roof rim
            col = mix(col, vNeon * mix(0.5, 2.2, night), clamp(belt, 0.0, 1.0) * mix(0.3, 1.0, night));   // neon belts subtle by day, full at night
            col *= 1.0 - 0.18 * (1.0 - smoothstep(8.0, 12.0, vP.y));   // darker street level
            stripe *= 0.0;
          } else { col = mix(vec3(0.24, 0.22, 0.3), vec3(0.5, 0.48, 0.55), uDay); }
          float d = length(vP - cameraPosition); float hz = cameraPosition.y > -0.6 ? min(mix(0.9, 0.55, uDay), 1.0 - exp(-d * uHazeK * mix(1.0, 0.55, uDay))) : 0.0;
          gl_FragColor = vec4(mix(col, uFog, hz), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
}

/* Oct 29 sweep 11:47 PM: Neon Harbor by DAY read as flat lilac slabs. Day-only paving on the platform tops (2 m stone tiles, grout,
   per-tile tint); it fades out with daylight so the locked night look is untouched. */
const PAVE_DAY = { value: 1 };
function paveShader(sh: any) {
    sh.uniforms.uPaveDay = PAVE_DAY;
    sh.vertexShader = 'varying vec3 vPvN;\n' + sh.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n vPvN = objectNormal;');
    sh.fragmentShader = 'uniform float uPaveDay; varying vec3 vPvN;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    { float top = step(0.9, vPvN.y) * step(0.16, dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2)));   /* tops only; the dark avenue stays road */
      vec2 tp = vHzW.xz / 2.0; vec2 cell = floor(tp), f = fract(tp);
      float grout = 1.0 - smoothstep(0.03, 0.07, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
      float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5);
      vec3 stone = mix(vec3(0.66, 0.6, 0.55), vec3(0.56, 0.54, 0.6), h) * (0.88 + 0.16 * h);
      vec3 paved = mix(stone, stone * 0.5, grout);
      diffuseColor.rgb = mix(diffuseColor.rgb, paved, top * uPaveDay * 0.85); }`);
}
function harborPlatformGeo() {
    const parts: THREE.BufferGeometry[] = [], H = HARBOR.y;
    for (const b of HBLOCKS) { const g = new THREE.BoxGeometry(b.x1 - b.x0, 1.6, b.z1 - b.z0); g.translate((b.x0 + b.x1) / 2, H - 0.8, (b.z0 + b.z1) / 2); parts.push(colorize(g, '#8e8aa3')); }
    for (const b of HBRIDGES) { const g = new THREE.BoxGeometry(b.x1 - b.x0, 0.8, b.z1 - b.z0); g.translate((b.x0 + b.x1) / 2, H - 0.4 + 0.01, (b.z0 + b.z1) / 2); parts.push(colorize(g, b.x1 - b.x0 > 12 || b.z1 - b.z0 > 12 ? '#6f6b80' : '#a59bb8')); }
    { const a = new THREE.BoxGeometry(AVENUE.hw * 2, 0.06, HARBOR.z1 - HARBOR.z0); a.translate(AVENUE.x, H + 0.03, (HARBOR.z0 + HARBOR.z1) / 2); parts.push(colorize(a, '#4a4658')); }   // the avenue the bridge lands on
    return merged(parts);
}
function harborNeonTrimGeo() {   // glowing edge lines along every canal-side block edge and footbridge rail
    const parts: THREE.BufferGeometry[] = [], H = HARBOR.y + 0.08;
    HBLOCKS.forEach((b, i) => {
        const c = NEON[i % NEON.length];
        for (const [x0, z0, x1, z1] of [[b.x0, b.z0, b.x1, b.z0], [b.x0, b.z1, b.x1, b.z1], [b.x0, b.z0, b.x0, b.z1], [b.x1, b.z0, b.x1, b.z1]]) { const L = Math.hypot(x1 - x0, z1 - z0), g = new THREE.BoxGeometry(x1 === x0 ? 0.25 : L, 0.22, x1 === x0 ? L : 0.25); g.translate((x0 + x1) / 2, H, (z0 + z1) / 2); parts.push(colorize(g, c)); }
    });
    { const g = new THREE.BoxGeometry(0.3, 0.06, HARBOR.z1 - HARBOR.z0); g.translate(AVENUE.x, HARBOR.y + 0.09, (HARBOR.z0 + HARBOR.z1) / 2); parts.push(colorize(g, '#ff4fd8')); }
    return merged(parts);
}
function harborSignsGeo() {
    const pos: number[] = [], col: number[] = [], uv: number[] = [], c = new THREE.Color(); setSeed(4040);
    HTOWERS.forEach((t, i) => {
        if (t.boss || rnd() < 0.35) return;
        const vertical = rnd() < 0.55, w = vertical ? 2.6 : 7 + rnd() * 4, h = vertical ? 8 + rnd() * 6 : 2.2 + rnd() * 1.2, side = Math.floor(rnd() * 4), y = HARBOR.y + 8 + rnd() * Math.max(2, Math.min(40, t.h - HARBOR.y - 20));
        if (y + h > t.h - 2) return;
        c.set(NEON[Math.floor(rnd() * NEON.length)]);
        const cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2, off = 0.35;
        let p0: number[], p1: number[], p2: number[], p3: number[];
        if (side === 0) { const z = t.z1 + off, x = cx + (rnd() - 0.5) * (t.x1 - t.x0 - w - 1); p0 = [x - w / 2, y, z]; p1 = [x + w / 2, y, z]; p2 = [x + w / 2, y + h, z]; p3 = [x - w / 2, y + h, z]; }
        else if (side === 1) { const z = t.z0 - off, x = cx + (rnd() - 0.5) * (t.x1 - t.x0 - w - 1); p0 = [x + w / 2, y, z]; p1 = [x - w / 2, y, z]; p2 = [x - w / 2, y + h, z]; p3 = [x + w / 2, y + h, z]; }
        else if (side === 2) { const x = t.x1 + off, z = cz + (rnd() - 0.5) * (t.z1 - t.z0 - w - 1); p0 = [x, y, z + w / 2]; p1 = [x, y, z - w / 2]; p2 = [x, y + h, z - w / 2]; p3 = [x, y + h, z + w / 2]; }
        else { const x = t.x0 - off, z = cz + (rnd() - 0.5) * (t.z1 - t.z0 - w - 1); p0 = [x, y, z - w / 2]; p1 = [x, y, z + w / 2]; p2 = [x, y + h, z + w / 2]; p3 = [x, y + h, z - w / 2]; }
        const ph = rnd();
        for (const [v, u0, v0] of [[p0, 0, 0], [p1, 1, 0], [p2, 1, 1], [p0, 0, 0], [p2, 1, 1], [p3, 0, 1]] as [number[], number, number][]) { pos.push(v[0], v[1], v[2]); col.push(c.r, c.g, c.b); uv.push(u0, v0 + ph * 10.0 * 0 + (vertical ? 2 : 0)); }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); return g;
}
const SIGN_MAT = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, uniforms: { uT: { value: 0 }, uDay: { value: 1 } },
    vertexShader: `attribute vec3 color; varying vec3 vC; varying vec2 vUv; varying vec3 vW; void main(){ vC = color; vUv = uv; vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vC; varying vec2 vUv; varying vec3 vW; uniform float uT; uniform float uDay;
    float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
    void main(){ bool vert = vUv.y > 1.5; vec2 uv = vec2(vUv.x, vert ? vUv.y - 2.0 : vUv.y);
      float border = 1.0 - step(0.07, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)) * (vert ? 2.0 : 1.0));
      vec2 g = vert ? vec2(uv.x * 3.0, uv.y * 9.0) : vec2(uv.x * 12.0, uv.y * 3.0); vec2 id = floor(g), f = fract(g);
      float glyph = step(0.45, h(id + floor(vW.xz))) * step(0.15, f.x) * step(f.x, 0.85) * step(0.2, f.y) * step(f.y, 0.8);
      float flick = 0.85 + 0.15 * step(0.5, fract(sin(floor(uT * 6.0) + vW.x) * 91.3));
      float night = 1.0 - uDay; vec3 base = vec3(0.05, 0.04, 0.09);
      vec3 col = base + vC * (border * 1.6 + glyph * 1.15) * mix(0.32, 1.9, night) * flick;
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
function harborStiltsGeo() {
    const parts: THREE.BufferGeometry[] = [];
    for (const b of HBLOCKS) for (let x = b.x0 + 4; x < b.x1; x += PHONE ? 18 : 13) for (let z = b.z0 + 4; z < b.z1; z += PHONE ? 18 : 13) { const g = new THREE.CylinderGeometry(0.7, 0.85, HARBOR.y - 1.6 + 30, 6, 1); g.translate(x, (HARBOR.y - 1.6 - 30) / 2, z); parts.push(colorize(g, '#5b5866')); }
    return merged(parts);
}
function harborLampsGeo() {
    const posts: THREE.BufferGeometry[] = [], heads: THREE.BufferGeometry[] = [];
    for (let z = HARBOR.z1 - 6; z > HARBOR.z0; z -= 18) for (const sx of [-1, 1]) { const x = AVENUE.x + sx * (AVENUE.hw - 0.6); const p = new THREE.CylinderGeometry(0.08, 0.11, 5, 5); p.translate(x, HARBOR.y + 2.5, z); posts.push(colorize(p, '#3b3846')); const h = new THREE.SphereGeometry(0.32, 6, 4); h.translate(x, HARBOR.y + 5.1, z); heads.push(h); }
    return { posts: merged(posts), heads: merged(heads) };
}
function cityImpostorGeo() {   // the main city as plain hazy boxes, for when the hero is out at Neon Harbor (the full city is hidden then)
    const parts: THREE.BufferGeometry[] = [];
    for (const b of buildings) { if ((b as any).sea || b.host !== undefined) continue; const g = new THREE.BoxGeometry(b.x1 - b.x0, b.h, b.z1 - b.z0); g.deleteAttribute('uv'); g.translate((b.x0 + b.x1) / 2, b.h / 2, (b.z0 + b.z1) / 2); parts.push(colorize(g, '#b9b2b6')); }
    return merged(parts);
}
const HCX = (HARBOR.x0 + HARBOR.x1) / 2, HCZ = (HARBOR.z0 + HARBOR.z1) / 2;
export const CITY_LOD = { far: false };
export function NeonHarbor({ kit }: { kit: SouthSeaKit }) {
    const towers = useMemo(harborTowerGeo, []), tmat = useMemo(() => harborTowerMat(kit.tod), []);
    const plat = useMemo(harborPlatformGeo, []), trim = useMemo(harborNeonTrimGeo, []), signs = useMemo(harborSignsGeo, []), stilts = useMemo(harborStiltsGeo, []), lamps = useMemo(harborLampsGeo, []), stiltPosts = useMemo(() => merged([stilts, lamps.posts]), [stilts, lamps]), imp = useMemo(cityImpostorGeo, []);
    const pmat = useMemo(() => { const m = new THREE.MeshLambertMaterial({ vertexColors: true }); m.onBeforeCompile = hazeShader(kit.tod); return m; }, []);
    const platMat = useMemo(() => { const m = new THREE.MeshLambertMaterial({ vertexColors: true }); m.onBeforeCompile = hazeShader(kit.tod, paveShader); m.customProgramCacheKey = () => 'harbor-pave'; return m; }, []);   /* own cache key: the shared hazeShader closure would reuse pmat's program */
    const trimMat = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), []);
    const lampMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ffd1f0' }), []);
    const impMat = useMemo(() => { const m = new THREE.MeshLambertMaterial({ vertexColors: true }); m.onBeforeCompile = hazeShader(kit.tod); return m; }, []);
    const near = useRef<THREE.Group>(null!), impRef = useRef<THREE.Mesh>(null!);
    useFrame(({ camera, clock }) => {
        const d = Math.hypot(camera.position.x - HCX, camera.position.z - HCZ), night = 1 - kit.tod.day.value;
        if (near.current) near.current.visible = d < (PHONE ? 420 : 560);   // full detail only for the city the hero is in
        CITY_LOD.far = camera.position.z < -760; if (impRef.current) impRef.current.visible = CITY_LOD.far;
        SIGN_MAT.uniforms.uT.value = clock.elapsedTime; SIGN_MAT.uniforms.uDay.value = kit.tod.day.value; PAVE_DAY.value = Math.max(0, Math.min(1, (kit.tod.day.value - 0.35) / 0.4));
        trimMat.color.setScalar(0.22 + 1.23 * night); lampMat.color.setRGB(1, 0.82, 0.94).multiplyScalar(0.4 + 0.9 * night);
    });
    return <group name="neon-harbor">
        <mesh geometry={towers} material={tmat} frustumCulled={false} />
        <mesh geometry={plat} material={platMat} frustumCulled={false} />
        <mesh geometry={trim} material={trimMat} onUpdate={(o) => o.layers.enable(SELECTIVE_BLOOM_LAYER)} frustumCulled={false} />
        <mesh ref={impRef} geometry={imp} material={impMat} visible={false} frustumCulled={false} />
        <group ref={near}>
            <mesh geometry={signs} material={SIGN_MAT} onUpdate={(o) => o.layers.enable(SELECTIVE_BLOOM_LAYER)} frustumCulled={false} />
            <mesh geometry={stiltPosts} material={pmat} frustumCulled={false} />   {/* 25 fps pass: stilts + lamp posts share pmat -> one draw call */}
            <mesh geometry={lamps.heads} material={lampMat} onUpdate={(o) => o.layers.enable(SELECTIVE_BLOOM_LAYER)} frustumCulled={false} />
        </group>
    </group>;
}

// 2c (Shifat 5:49 PM "lighthouse light must be soft god rays, not sharp geometry"): two soft light shafts, each a camera-facing ribbon
// around the beam axis with a gaussian falloff across, fading along its length (no hard edges at any angle), plus a soft glow sprite that
// flares when the sweeping beam points toward the camera. Night only; 2 quads + 1 sprite, cheap on phones.
const SHAFT_MAT = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uI: { value: 0 }, uT: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; varying vec3 vW; uniform float uI; uniform float uT;
      float n2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(n2(i), n2(i + vec2(1, 0)), f.x), mix(n2(i + vec2(0, 1)), n2(i + vec2(1, 1)), f.x), f.y); }
      void main(){ float u = vUv.x * 2.0 - 1.0, v = vUv.y;
        float across = exp(-u * u * 4.5), along = pow(1.0 - v, 1.7) * smoothstep(0.0, 0.05, v);
        float dust = 0.75 + 0.25 * vn(vec2(v * 18.0 - uT * 0.3, u * 2.0 + uT * 0.1));
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.72) * across * along * dust * uI, 1.0); }`,
});
function glowTex() { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!; const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,246,220,1)'); gr.addColorStop(0.25, 'rgba(255,230,170,0.55)'); gr.addColorStop(1, 'rgba(255,220,150,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const _sa = new THREE.Vector3(), _sc = new THREE.Vector3(), _ss = new THREE.Vector3(), _sl = new THREE.Vector3();
export function LightShafts({ kit, lampY }: { kit: SouthSeaKit; lampY: number }) {
    const geo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1], 2)); g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]); return g; }, []);
    const sprite = useMemo(() => new THREE.SpriteMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#fff2cc' }), []);
    const mesh = useRef<THREE.Mesh>(null!), spr = useRef<THREE.Sprite>(null!);
    useFrame(({ camera, clock }) => {
        const night = Math.max(0, Math.min(1, (0.85 - kit.tod.day.value) / 0.6)), on = night > 0.02; if (mesh.current) mesh.current.visible = on; if (spr.current) spr.current.visible = on; if (!on) return;
        const t = clock.elapsedTime, pa = geo.attributes.position as THREE.BufferAttribute, L = PHONE ? 90 : 120, w0 = 0.9, w1 = 16; _sl.set(LIGHTHOUSE.x, lampY, LIGHTHOUSE.z);
        let flare = 0;
        for (let b = 0; b < 2; b++) {
            const th = t * 0.55 + b * Math.PI; _sa.set(Math.cos(th), -0.07, Math.sin(th)).normalize();
            _sc.copy(camera.position).sub(_sl); const toCam = _sc.clone().normalize(); flare = Math.max(flare, Math.pow(Math.max(0, _sa.dot(toCam)), 10));
            _ss.crossVectors(_sa, _sc).normalize();
            const set = (k: number, along: number, side: number) => pa.setXYZ(b * 4 + k, _sl.x + _sa.x * along + _ss.x * side, _sl.y + _sa.y * along + _ss.y * side, _sl.z + _sa.z * along + _ss.z * side);
            set(0, 0, -w0); set(1, 0, w0); set(2, L, w1); set(3, L, -w1);
        }
        pa.needsUpdate = true; geo.computeBoundingSphere();
        SHAFT_MAT.uniforms.uI.value = 0.42 * night; SHAFT_MAT.uniforms.uT.value = t;
        if (spr.current) { spr.current.scale.setScalar((5 + 16 * flare) * (0.6 + 0.4 * night)); sprite.opacity = (0.55 + 0.45 * flare) * night; }
    });
    return <group>
        <mesh ref={mesh} geometry={geo} material={SHAFT_MAT} frustumCulled={false} renderOrder={5} />
        <sprite ref={spr} material={sprite} position={[LIGHTHOUSE.x, lampY, LIGHTHOUSE.z]} onUpdate={(o) => o.layers.enable(SELECTIVE_BLOOM_LAYER)} renderOrder={6} />
    </group>;
}


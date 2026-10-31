import { HALF, PARK_POND_Y, WATER_Y, WATER_Z, isLakeWater, seabedAt, waterSurfaceAt, type Sim } from '../sim';
import * as THREE from 'three';
import { QUALITY } from '../quality';
import { TOD } from './env';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { waterRenderY } from '../water/waveHeight';

// Underwater life (user must-haves 10:29): kelp forest, jellyfish, tiny bubbles, god rays, current drift. Reference cues (viewed underwater shots): cyan light band near the surface, light shafts, sandy floor, haze to teal. All procedural approximations, small instance counts.
const UW_FOG = 'vec3(0.09, 0.43, 0.55)';
const kelpMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `uniform float uTime; varying vec3 vW; varying float vH;
    void main(){ vec3 p = position; float h = clamp(p.y / 6.0, 0.0, 1.0); vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float cur = sin(uTime * 0.7 + ip.x * 0.15 + ip.z * 0.1 + p.y * 0.5) * 0.7 + sin(uTime * 0.4 + p.y * 0.9) * 0.2;
      p.x += cur * h * h; p.z += cos(uTime * 0.6 + ip.z * 0.2 + p.y * 0.4) * 0.35 * h * h;
      vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0); vW = w.xyz; vH = h; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vW; varying float vH;
    void main(){ vec3 col = mix(vec3(0.12, 0.30, 0.16), vec3(0.42, 0.62, 0.22), vH); float d = length(vW - cameraPosition); col = col * exp(-vec3(0.45, 0.07, 0.02) * d * 0.12) + ${UW_FOG} * (1.0 - exp(-d * 0.028)); gl_FragColor = vec4(col, 1.0); }`,
    side: THREE.DoubleSide,
});
// God rays (Shifat Oct 29 "godrays can be better, ref real images"): long soft shafts from the surface, slanted along the sun,
// several stripes per sheet flickering with the waves above, brightest just under the surface and fading with depth.
// Sheets are cylindrical billboards placed around the camera, so the fan converges in perspective like real underwater light.
const _rayAx = new THREE.Vector3();
const RAY_N = QUALITY.coarse || QUALITY.weakGpu ? 14 : 26, RAY_LEN = 42;
const rayMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSurf: { value: -1 }, uDay: TOD.day }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vU; varying float vY; void main(){ vU = uv; vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying vec2 vU; varying float vY; uniform float uTime, uSurf, uDay;
      float h(float x){ return fract(sin(x * 127.1) * 43758.5453); }
      void main(){
        float x = vU.x, t = uTime;
        float s = 0.0; for (int k = 0; k < 4; k++) { float fk = float(k), c = 0.15 + 0.7 * h(fk + floor(t * 0.05 + fk) * 3.1); float w = 0.035 + 0.06 * h(fk * 7.0 + 1.0);
          s += (1.0 - smoothstep(w * 0.3, w, abs(x - c - 0.04 * sin(t * 0.35 + fk * 2.1)))) * (0.55 + 0.45 * sin(t * (0.9 + fk * 0.37) + fk * 4.0)); }
        float edge = smoothstep(0.0, 0.12, x) * (1.0 - smoothstep(0.88, 1.0, x));
        float depth = uSurf - vY; float fade = exp(-max(depth, 0.0) * 0.055) * smoothstep(0.0, 1.2, depth);
        float a = s * edge * fade * mix(0.04, 1.0, uDay * uDay) * 0.42;   /* night: only a faint moon trace of the shafts (they read as daylight at night) */
        gl_FragColor = vec4(vec3(0.62, 0.93, 1.0) * a, a);
      }`,
});
// Shifat Oct 29 "water bubble must be randomized particle emission": round glints with a per-particle size (aSize) and rgba fade.
const bubbleMat = new THREE.PointsMaterial({color:'#dff8ff',size:0.11,sizeAttenuation:true,transparent:true,opacity:0.75,depthWrite:false,vertexColors:true});
bubbleMat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float aSize;\n' + shader.vertexShader.replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nfloat br=length(gl_PointCoord-0.5);if(br>0.5)discard;').replace('#include <opaque_fragment>', 'diffuseColor.a*=(1.0-smoothstep(0.32,0.5,br))*(0.32+0.68*smoothstep(0.22,0.40,br));\n#include <opaque_fragment>');
};
bubbleMat.customProgramCacheKey = () => 'round-bubble-emitter-v3';
// Pooled randomized bubble emitter: one Points draw, fixed typed arrays, no per-frame allocation. Each particle gets a random
// size, rise speed, wobble (amplitude/frequency/phase), sideways drift and lifetime; it fades in, rises (speeding up slightly as it
// grows, like a real bubble), and pops/fades just under the real wave-displaced surface at its own x/z. Emitters: seabed vents at
// random spots around the camera, plus a stream off the hero while moving/diving (rate scales with speed).
const BUB_N = QUALITY.coarse || QUALITY.weakGpu ? 110 : 220;
export function Underwater({ sim }: { sim: Sim }) {
    const kelp = useRef<THREE.InstancedMesh>(null!), bub = useRef<THREE.Points>(null!), rays = useRef<THREE.Group>(null!), rayInst = useRef<THREE.InstancedMesh>(null!);
    const rayGeo = useMemo(() => { const g = new THREE.PlaneGeometry(1, RAY_LEN, 1, 1); g.translate(0, -RAY_LEN / 2, 0); return g; }, []);
    const rayS = useMemo(() => Array.from({ length: 26 }, (_, i) => ({ a: i * 2.399, r: 3 + ((i * 37) % 26), w: 2.5 + ((i * 13) % 6), ph: i * 1.7 })), []), rayO = useMemo(() => new THREE.Object3D(), []);
    const kGeo = useMemo(() => { const g = new THREE.PlaneGeometry(0.5, 6, 1, 6); g.translate(0, 3, 0); return g; }, []);
    const bGeo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BUB_N * 3).fill(-9999), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(BUB_N * 4).fill(1), 4)); g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(BUB_N).fill(1), 1)); return g; }, []);
    // particle state (pooled): base x/z, y, rise speed, age, life, wobble amp/freq/phase, drift x/z, size; alive when age < life
    const B = useMemo(() => ({ x: new Float32Array(BUB_N), y: new Float32Array(BUB_N), z: new Float32Array(BUB_N), v: new Float32Array(BUB_N), age: new Float32Array(BUB_N).fill(1), life: new Float32Array(BUB_N).fill(0), wa: new Float32Array(BUB_N), wf: new Float32Array(BUB_N), wp: new Float32Array(BUB_N), dx: new Float32Array(BUB_N), dz: new Float32Array(BUB_N), sz: new Float32Array(BUB_N), acc: 0, heroAcc: 0, next: 0, lastT: -1 }), []);
    useEffect(() => {
        let r = 3; const rn = () => (r = (r * 16807) % 2147483647) / 2147483647; const o = new THREE.Object3D();
        for (let i = 0; i < 1400; i++) { const cx = (rn() - 0.5) * 2 * (HALF - 20), cz = WATER_Z - 6 - rn() * 110, k = 0.6 + rn() * 1.1; o.position.set(cx, seabedAt(cx, cz), cz); o.rotation.set(0, rn() * 3.14, 0); o.scale.set(k * (0.5 + rn() * 0.6), 0.45 + rn() * 1.0, k); o.updateMatrix(); kelp.current.setMatrixAt(i, o.matrix); }
        kelp.current.instanceMatrix.needsUpdate = true;
    }, []);
    useFrame((st) => {
        const t = sim.t, hx = sim.pos[0], hy = sim.pos[1], hz = sim.pos[2], inBay = hz < WATER_Z + 6, inLake = isLakeWater(hx, hz), inWater = inBay || inLake, surfaceY = inLake ? waterSurfaceAt(hx, hz, t) : WATER_Y, under = inWater && st.camera.position.y < surfaceY + 1.5 && sim.mode === 'play';
        kelpMat.uniforms.uTime.value = t; rayMat.uniforms.uTime.value = t;
        kelp.current.visible = inBay && under;   /* Shifat Oct 31 2:29 PM night screenshot: seen from above through the clear water the blades read as rain streaks over the whole sea - only drawn when the lens is at/below the surface */ const cu = under && st.camera.position.y < surfaceY - 0.05 && st.camera.position.y < waterRenderY(st.camera.position.x, st.camera.position.z, t) - 0.05; bub.current.visible = cu; rays.current.visible = cu;   // env-iter3: also below the real (wave-displaced) sea surface, not just the flat sea level   // shafts and bubbles only once the camera is really below either water surface
        if (!inWater) return;
        if (under) {
            const pa = bub.current.geometry.attributes.position as THREE.BufferAttribute, ca = bub.current.geometry.attributes.color as THREE.BufferAttribute, za = bub.current.geometry.attributes.aSize as THREE.BufferAttribute;
            const dt = B.lastT < 0 ? 0.016 : Math.min(0.1, Math.max(0, t - B.lastT)); B.lastT = t;
            const floor = inLake ? PARK_POND_Y - 3.6 : seabedAt(st.camera.position.x, st.camera.position.z) + 0.4, cx = st.camera.position.x, cz = st.camera.position.z, cur = Math.sin(t * 0.3) * 0.25;
            const spawn = (x: number, y: number, z: number, small: boolean) => {
                if (inLake && !isLakeWater(x, z)) return;
                let k = -1; for (let j = 0; j < BUB_N; j++) { const q = (B.next + j) % BUB_N; if (B.age[q] >= B.life[q]) { k = q; break; } }
                if (k < 0) return; B.next = (k + 1) % BUB_N;
                const r = Math.random();
                B.x[k] = x; B.y[k] = y; B.z[k] = z; B.age[k] = 0; B.life[k] = 2.5 + Math.random() * 5.5;
                B.sz[k] = small ? 0.35 + r * 0.6 : 0.45 + r * r * 1.6; B.v[k] = 0.35 + B.sz[k] * 0.45 + Math.random() * 0.35;
                B.wa[k] = 0.03 + Math.random() * 0.12; B.wf[k] = 2 + Math.random() * 5; B.wp[k] = Math.random() * 6.283;
                B.dx[k] = (Math.random() - 0.5) * 0.25; B.dz[k] = (Math.random() - 0.5) * 0.25;
            };
            // seabed vents: Poisson-ish random emission in a 13 m disc around the camera, sometimes in little bursts
            B.acc += dt * (BUB_N * 0.11);
            while (B.acc >= 1) { B.acc -= 1; const a = Math.random() * 6.283, rr = 1.5 + Math.sqrt(Math.random()) * 11.5, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr, burst = Math.random() < 0.18 ? 2 + Math.floor(Math.random() * 4) : 1; for (let q = 0; q < burst; q++) spawn(x + (Math.random() - 0.5) * 0.3, floor + Math.random() * 0.4, z + (Math.random() - 0.5) * 0.3, burst > 1); }
            // hero stream: more bubbles the faster you swim, extra on a dive
            const hv = Math.hypot(sim.vel[0], sim.vel[1], sim.vel[2]);
            if (hy < surfaceY - 0.3) { B.heroAcc += dt * (hv * 2.2 + (sim.dive ? 10 : 0) + 0.6); while (B.heroAcc >= 1) { B.heroAcc -= 1; spawn(hx + (Math.random() - 0.5) * 0.6, hy + 0.6 + Math.random() * 0.8, hz + (Math.random() - 0.5) * 0.6, true); } }
            for (let i = 0; i < BUB_N; i++) {
                if (B.age[i] >= B.life[i]) { pa.setXYZ(i, 0, -9999, 0); ca.setW(i, 0); continue; }
                B.age[i] += dt; B.v[i] = Math.min(B.v[i] + dt * 0.08, 1.6); B.y[i] += B.v[i] * dt; B.x[i] += (B.dx[i] + cur) * dt; B.z[i] += B.dz[i] * dt;
                const w = Math.sin(B.age[i] * B.wf[i] + B.wp[i]) * B.wa[i], bx = B.x[i] + w, bz = B.z[i] + Math.cos(B.age[i] * B.wf[i] * 0.8 + B.wp[i]) * B.wa[i] * 0.7;
                const top = waterRenderY(bx, bz, t) - 0.1;
                if (B.y[i] >= top) { B.age[i] = B.life[i]; pa.setXYZ(i, 0, -9999, 0); ca.setW(i, 0); continue; }   // pop just under the real swell
                const fin = Math.min(1, B.age[i] / 0.35), fout = Math.min(1, (B.life[i] - B.age[i]) / 0.6, (top - B.y[i]) / 0.35);
                pa.setXYZ(i, bx, B.y[i], bz); ca.setW(i, fin * Math.max(0, fout)); za.setX(i, B.sz[i] * (1 + 0.15 * Math.min(1, B.age[i] / 3)));
            }
            za.needsUpdate = true;
            pa.needsUpdate = true; ca.needsUpdate = true; bub.current.geometry.computeBoundingSphere();
            rays.current.position.set(0, 0, 0); rays.current.rotation.y = 0; rayMat.uniforms.uSurf.value = surfaceY;
            { const cam = st.camera, cx = cam.position.x, cz = cam.position.z, sun = TOD.sunU.value as THREE.Vector3, tilt = Math.min(0.5, Math.hypot(sun.x, sun.z) * 0.45), sa = Math.atan2(sun.x, sun.z), m = rayInst.current;
              for (let i = 0; i < RAY_N; i++) { const q = rayS[i], a = q.a + Math.sin(t * 0.03 + q.ph) * 0.3, x = cx + Math.cos(a) * q.r, z = cz + Math.sin(a) * q.r;
                rayO.position.set(x, surfaceY + 0.05, z); rayO.rotation.set(0, 0, 0); rayO.rotateY(Math.atan2(cx - x, cz - z)); rayO.rotateOnWorldAxis(_rayAx.set(Math.cos(sa), 0, -Math.sin(sa)), -tilt); rayO.scale.set(q.w * (0.8 + 0.2 * Math.sin(t * 0.4 + q.ph)), 1, 1); rayO.updateMatrix(); m.setMatrixAt(i, rayO.matrix); }
              m.instanceMatrix.needsUpdate = true; }
        }
    });
    return <group>
        <instancedMesh ref={kelp} args={[kGeo, kelpMat, 1400]} frustumCulled={false} />
        <points ref={bub} geometry={bGeo} frustumCulled={false}><primitive object={bubbleMat} attach="material" /></points>
        <group ref={rays}><instancedMesh ref={rayInst} args={[rayGeo, rayMat, RAY_N]} frustumCulled={false} /></group>
    </group>;
}


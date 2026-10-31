import { BEACH_DIR, HALF, LAKE_SHORE, PARK, PARK_POND, WATER_Z, bridgeSurfaceAt, buildings, parkH, sandWeight, world, type Sim } from '../sim';
import * as THREE from 'three';
import { TREE_PATTERN, TREE_TYPES, cherryLeafShader, coniferGeo, leafWindShader, palmFrondShader, palmFrondTex, palmGeo, palmTrunkTex, treeGeo, treeWindTime, trunkWindShader } from './trees';
import { QK } from '../quality';
import { TOD } from './env';
import { PINE_URL } from '../texdata';
import { useEffect, useMemo, useRef } from 'react';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SELECTIVE_BLOOM_LAYER } from '../renderLayers';
import { useFrame } from '@react-three/fiber';

const DBG = !!(import.meta as any).env.VITE_DBG;   // test hooks only in instrumented builds

// Park forest (trees, bushes, floor grass, ink outlines) and the meadow (grass tufts + flowers).
export function Forest({ sim, renderGround = true }: { sim: Sim; renderGround?: boolean }) {
    const lo = useRef<THREE.InstancedMesh[]>([]), last = useRef([1e9, 1e9]);
    const grass = useRef<THREE.Mesh>(null!), tr = useRef<THREE.InstancedMesh[]>([]), lf = useRef<THREE.InstancedMesh[]>([]), bush = useRef<THREE.InstancedMesh>(null!);
    const [leafTex, barkTex, pineTex, pbarkTex] = useMemo(() => { const l = new THREE.TextureLoader(); const mk = (u: string, rep = false) => { const t = l.load(u); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = QK.anisotropy; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 3); } return t; };
        return [mk('/spray145.png'), mk('/bark.jpg', true), mk(PINE_URL), mk('/pinebark.jpg', true)]; }, []);
    const geos = useMemo(() => TREE_TYPES.map(({ kind, seed }) => {
        const con = kind === 'pine' || kind === 'spruce';
        if (kind === 'palm') { const p = palmGeo(seed); return { trunk: p.trunk, leaves: p.leaves, lo: p.lo, con, kind }; }
        const hi = con ? coniferGeo(kind, seed, kind === 'pine' ? 5 : 6, 3, 1.12) : treeGeo(kind as any, seed, Math.round((kind === 'broad' ? 460 : kind === 'cherry' ? 560 : 340) * QK.foliage), 1.45);
        const lw = con ? coniferGeo(kind, seed, 3, 2, 1.6).leaves : treeGeo(kind as any, seed, Math.round((kind === 'cherry' ? 140 : 110) * (0.5 + 0.5 * QK.foliage)), 2.2).leaves;
        return { trunk: hi.trunk, leaves: hi.leaves, lo: lw, con, kind };
    }), []);
    const pts = useMemo(() => { let r = 7; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647; const a: { x: number; z: number; s: number; c: number; v: number }[] = []; for (let i = 0; i < 600 && a.length < 130; i++) { const px = PARK.x0 + 6 + rnd() * (PARK.x1 - PARK.x0 - 12), pz = PARK.z0 + 6 + rnd() * (PARK.z1 - PARK.z0 - 12), cxm = (PARK.x0 + PARK.x1) / 2, czm = (PARK.z0 + PARK.z1) / 2; if (Math.hypot(px - cxm, pz - czm) < 54 || Math.abs((px - cxm) - (pz - czm) * 0.6) < 6) continue; if (rnd() < 0.2) continue; a.push({ x: px, z: pz, s: 0.8 + rnd() * 0.5, c: rnd(), v: TREE_PATTERN[a.length % TREE_PATTERN.length] }); }
        // Small street-side clusters use the same families and LOD, clear of buildings and intersections.
        const street = world.streetBlds.map((b,i)=>({b,i,k:Math.sin((b.x0*13.37+b.z0*7.17))*43758.5453%1})).sort((a,b)=>a.k-b.k);
        for (let i = 0; i < street.length && a.length < 190; i++) {
            const b = street[i].b;
            const x = b.x1 + 2.5, z = (b.z0 + b.z1) / 2 + (Math.floor(i / 3) % 2 ? 4 : -4);
            if (z < WATER_Z + 8 || x > HALF - 4 || buildings.some(q => x > q.x0 - 1.3 && x < q.x1 + 1.3 && z > q.z0 - 1.3 && z < q.z1 + 1.3)) continue;
            a.push({ x, z, s: 0.62 + rnd() * 0.14, c: rnd(), v: [0, 3, 5][Math.floor(i / 3) % 3] });
        }
        // env-iter1 lakeside: cherry blossoms ring the lake on the trail-facing banks, palms stand on the beach sand.
        const nearTrail = (x: number, z: number, m: number) => Math.abs((x - PARK_POND.cx) - (z - PARK_POND.cz) * 0.6) < m || bridgeSurfaceAt(x, z) !== null;
        let nCh = 0, nPalm = 0;
        for (let i = 0; i < 500 && nCh < 18; i++) {
            const ang = rnd() * 6.283, rad = PARK_POND.rx + 4.5 + rnd() * 10, x = PARK_POND.cx + Math.cos(ang) * rad, z = PARK_POND.cz + Math.sin(ang) * rad;
            if (sandWeight(x, z) > 0.05 || nearTrail(x, z, 6.5) || a.some((p) => Math.hypot(p.x - x, p.z - z) < 5.2)) continue;
            a.push({ x, z, s: 0.82 + rnd() * 0.3, c: rnd(), v: 3 }); nCh++;
        }
        for (let i = 0; i < 500 && nPalm < 9; i++) {
            const ang = BEACH_DIR + (rnd() - 0.5) * 2.0, rad = PARK_POND.rx * LAKE_SHORE + 3 + rnd() * 11, x = PARK_POND.cx + Math.cos(ang) * rad, z = PARK_POND.cz + Math.sin(ang) * rad;
            if (sandWeight(x, z) < 0.9 || nearTrail(x, z, 5) || a.some((p) => Math.hypot(p.x - x, p.z - z) < 5.5)) continue;
            a.push({ x, z, s: 0.85 + rnd() * 0.3, c: rnd(), v: 4 }); nPalm++;
        }
        if (DBG) (window as any).__trees = a.map((p) => [p.x, parkH(p.x, p.z), p.z, p.v, p.s]);
        return a; }, []);
    const bushTex = useMemo(()=>{const t=new THREE.TextureLoader().load('/shrub134.png');t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=QK.anisotropy;return t;},[]);
    const bushGeo = useMemo(parkBushGeo,[]);
    // falling cherry petals: one Points draw, positions looped in the vertex shader around the lakeside cherries.
    const petalU = useMemo(() => ({ uTime: { value: 0 }, uDayP: TOD.day }), []);
    const petalGeo = useMemo(() => {
        const ch = pts.filter((p) => p.v === 3 && Math.hypot(p.x - PARK_POND.cx, p.z - PARK_POND.cz) < 40), n = Math.min(26, ch.length) * 9;
        const P = new Float32Array(n * 3), ph = new Float32Array(n); let r = 31; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < n; i++) { const t = ch[i % ch.length], a = rnd() * 6.28, d = rnd() * 4.5 * t.s; P[i * 3] = t.x + Math.cos(a) * d; P[i * 3 + 2] = t.z + Math.sin(a) * d; P[i * 3 + 1] = parkH(t.x, t.z) + 0.05; ph[i] = rnd(); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('ph', new THREE.BufferAttribute(ph, 1)); return g;
    }, [pts]);
    if (DBG) (window as any).__treePts = pts;
    const NT = TREE_TYPES.length;
    const place = (hx: number, hz: number) => {
        const o = new THREE.Object3D(), col = new THREE.Color(); const ct = Array(NT).fill(0), ch = Array(NT).fill(0), cl = Array(NT).fill(0);
        pts.forEach((p) => { const d = Math.hypot(p.x - hx, p.z - hz); if (d > (p.x > PARK.x0 && p.x < PARK.x1 && p.z > PARK.z0 && p.z < PARK.z1 ? 230 : 140) || ct[p.v] >= 70) return; o.rotation.set(0, p.c * 6.28, 0); o.position.set(p.x, 0.05 + parkH(p.x, p.z), p.z); o.scale.set(p.s, p.s * (0.9 + p.c * 0.25), p.s); o.updateMatrix(); const v = p.v; { const q = (Math.sin(p.x * 0.37 + p.z * 0.21) + 1) * 0.5, w = (p.c * 7.3) % 1; if (geos[v].kind === 'cherry' || geos[v].kind === 'palm') col.setRGB(1, 1, 1).multiplyScalar(0.86 + w * 0.22); else col.setHSL(geos[v].con ? 0.31 + (w - 0.5) * 0.06 : 0.20 + q * 0.10 + w * 0.035, geos[v].con ? 0.28 : 0.45 + w * 0.2, 0.66 + ((p.c * 3.1) % 1) * 0.30); } tr.current[v].setMatrixAt(ct[v]++, o.matrix); const M = d < QK.leafLodDist ? lf.current[v] : lo.current[v], k = d < QK.leafLodDist ? ch : cl; M.setMatrixAt(k[v], o.matrix); M.setColorAt(k[v]++, col); });
        for (let v = 0; v < NT; v++) { tr.current[v].count = ct[v]; lf.current[v].count = ch[v]; lo.current[v].count = cl[v]; [tr.current[v], lf.current[v], lo.current[v]].forEach((m) => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); if(m.boundingSphere) m.boundingSphere.radius += 0.7; }); }
    };
    useFrame((st) => { treeWindTime.value = DBG && (window as any).__windT !== undefined ? (window as any).__windT : st.clock.elapsedTime; if(bush.current) (bush.current.material as THREE.MeshLambertMaterial).emissive.set('#263c1c').multiplyScalar(0.12+0.88*TOD.day.value); for (let v = 0; v < NT; v++) { const a = lf.current[v], b = lo.current[v]; const em = geos[v].kind === 'cherry' ? '#6e3f50' : geos[v].kind === 'palm' ? '#2a3a14' : '#426439'; if(a) (a.material as THREE.MeshLambertMaterial).emissive.set(em).multiplyScalar(0.12 + 0.88 * TOD.day.value); if(b) (b.material as THREE.MeshLambertMaterial).emissive.set(em).multiplyScalar(0.12 + 0.88 * TOD.day.value); } petalU.uTime.value = st.clock.elapsedTime; const hx = sim.pos[0], hz = sim.pos[2]; if (Math.hypot(hx - last.current[0], hz - last.current[1]) > 6) { last.current = [hx, hz]; place(hx, hz); } });
    useEffect(() => {
        const o = new THREE.Object3D(), col = new THREE.Color(); place(1e5, 1e5); last.current = [1e9, 1e9];
        for (let i = 0; i < 70; i++) { const p = pts[i < 45 ? i % pts.length : Math.min(pts.length - 1, 130 + i - 45)], k = 0.8 + p.c; o.rotation.set(0, p.c * 9, 0); o.position.set(p.x + (i < 45 ? 3 + (i % 5) : 0), 0.02 + parkH(p.x + (i < 45 ? 3 + (i % 5) : 0), p.z + (i < 45 ? 2 : 0)), p.z + (i < 45 ? 2 : 0)); o.scale.set(k * (0.8 + (i % 3) * 0.25), k * (0.55 + (i % 4) * 0.12), k * (0.8 + ((i + 1) % 3) * 0.25)); o.updateMatrix(); bush.current.setMatrixAt(i, o.matrix); bush.current.setColorAt(i, col.setHSL(0.22 + ((p.c * 5.7) % 1) * 0.08, 0.18 + ((p.c * 2.3) % 1) * 0.12, 0.55 + ((p.c * 9.1) % 1) * 0.20)); }
        bush.current.instanceMatrix.needsUpdate = true; bush.current.instanceColor!.needsUpdate = true;
    }, [pts]);
    const cx = (PARK.x0 + PARK.x1) / 2, cz = (PARK.z0 + PARK.z1) / 2;
    useFrame(() => { const gm2 = grass.current && (grass.current.material as THREE.MeshLambertMaterial); if (gm2) { const nn2 = 1 - TOD.day.value; gm2.color.setRGB(1 - 0.35 * nn2, 1 - 0.12 * nn2, 1 + 0.35 * nn2); gm2.emissive.setRGB(0.0, 0.002 * nn2, 0.006 * nn2); } });   // night: cool the ground tone to match the cool tufts
    const terrain = useMemo(() => {   // displaced grids following parkH, in world-aligned coordinates around (cx, cz)
        const mk = (w: number, h: number, sw: number, sh: number, yaw: number, lift: number) => { const g = new THREE.PlaneGeometry(w, h, sw, sh); g.rotateX(-Math.PI / 2); g.rotateY(yaw); const pa = g.attributes.position; for (let i = 0; i < pa.count; i++) pa.setY(i, parkH(cx + pa.getX(i), cz + pa.getZ(i)) + lift); g.computeVertexNormals(); return g; };
        const fl = mk(PARK.x1 - PARK.x0, PARK.z1 - PARK.z0, 80, 80, 0, 0);
        { // flat 3-tone meadow fills (light / mid / dark patches, hue drifts yellow on the light ones), as in the toon-grassland refs; vertex colours, no extra cost
            const pa = fl.attributes.position, ca = new Float32Array(pa.count * 3), c0 = new THREE.Color('#63805b'), cl = new THREE.Color('#7c9469'), cd = new THREE.Color('#506b4b'), tc = new THREE.Color();
            for (let i = 0; i < pa.count; i++) { const x = cx + pa.getX(i), z = cz + pa.getZ(i), n = Math.sin(x * 0.045 + 1) * Math.cos(z * 0.06) + 0.5 * Math.sin(x * 0.11 + z * 0.07 + 2), t = Math.max(-1, Math.min(1, n * 1.1)) * 0.7, q = Math.round(t * 8) / 8; if (q >= 0) tc.copy(c0).lerp(cl, q); else tc.copy(c0).lerp(cd, -q); ca[i * 3] = tc.r; ca[i * 3 + 1] = tc.g; ca[i * 3 + 2] = tc.b; }
            fl.setAttribute('color', new THREE.BufferAttribute(ca, 3));
        }
        return { floor: fl, path: mk(8, 190, 2, 90, Math.atan(0.6), 0.04) };
    }, []);
    return <group>
        {renderGround && <mesh ref={grass} position={[cx, 0.05, cz]} geometry={terrain.floor}><meshLambertMaterial color="#ffffff" vertexColors /></mesh>}
        {renderGround && <mesh position={[cx, 0.09, cz]} geometry={terrain.path}><meshLambertMaterial color="#b89865" /></mesh>}
        {geos.map((g, v) => <group key={v}>
            <instancedMesh ref={(m) => { if (m) tr.current[v] = m; }} args={[g.trunk, undefined, 70]} frustumCulled={false}><meshLambertMaterial map={g.kind === 'palm' ? palmTrunkTex() : g.con ? pbarkTex : barkTex} bumpMap={g.kind === 'palm' ? palmTrunkTex() : g.con ? pbarkTex : barkTex} bumpScale={g.kind === 'palm' ? 1.6 : 2.2} vertexColors color={g.kind === 'palm' ? '#a89274' : g.kind === 'cherry' ? '#a5949a' : '#ffffff'} emissive={g.kind === 'palm' ? '#3a3024' : '#4a3a2c'} side={THREE.DoubleSide} onBeforeCompile={trunkWindShader} /></instancedMesh>
            {g.kind === 'palm' ? <>
                <instancedMesh ref={(m) => { if (m) lo.current[v] = m; }} args={[g.lo, undefined, 70]}><meshLambertMaterial map={palmFrondTex()} vertexColors emissive="#2a3a14" alphaTest={0.5} side={THREE.DoubleSide} onBeforeCompile={palmFrondShader} /></instancedMesh>
                <instancedMesh ref={(m) => { if (m) lf.current[v] = m; }} args={[g.leaves, undefined, 70]}><meshLambertMaterial map={palmFrondTex()} vertexColors emissive="#2a3a14" alphaTest={0.5} side={THREE.DoubleSide} onBeforeCompile={palmFrondShader} /></instancedMesh>
            </> : <>
                <instancedMesh ref={(m) => { if (m) lo.current[v] = m; }} args={[g.lo, undefined, 70]}><meshLambertMaterial map={g.con ? pineTex : leafTex} vertexColors emissive="#426439" alphaTest={0.5} side={THREE.DoubleSide} onBeforeCompile={g.kind === 'cherry' ? cherryLeafShader : leafWindShader} /></instancedMesh>
                <instancedMesh ref={(m) => { if (m) lf.current[v] = m; }} args={[g.leaves, undefined, 70]}><meshLambertMaterial map={g.con ? pineTex : leafTex} vertexColors emissive="#426439" alphaTest={0.5} side={THREE.DoubleSide} onBeforeCompile={g.kind === 'cherry' ? cherryLeafShader : leafWindShader} /></instancedMesh>
            </>}
        </group>)}
        <points geometry={petalGeo} frustumCulled={false}><shaderMaterial transparent depthWrite={false} uniforms={petalU} vertexShader={`uniform float uTime; attribute float ph; varying float vA; varying float vR; void main(){ float life = fract(uTime * 0.055 + ph); vec3 p = position; p.y += 4.6 * (1.0 - life); p.x += sin(uTime * 0.9 + ph * 40.0) * 0.6 + life * 2.2; p.z += cos(uTime * 0.7 + ph * 23.0) * 0.5; vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; vA = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.85, 1.0, life)); vR = uTime * 2.0 + ph * 30.0; gl_PointSize = clamp(55.0 / -mv.z, 1.5, 7.0); }`} fragmentShader={`uniform float uDayP; varying float vA; varying float vR; void main(){ vec2 q = gl_PointCoord - 0.5; float c = cos(vR), s = sin(vR); q = mat2(c, -s, s, c) * q; float e = length(q * vec2(1.0, 1.9)); if (e > 0.48) discard; gl_FragColor = vec4(mix(vec3(0.5, 0.33, 0.42), vec3(1.0, 0.78, 0.86), uDayP), vA * 0.95); }`} /></points>
        <instancedMesh ref={bush} args={[undefined, undefined, 70]} frustumCulled={false}><primitive object={bushGeo} attach="geometry" /><meshLambertMaterial map={bushTex} color="#dce1cd" emissive="#182510" alphaTest={0.5} side={THREE.DoubleSide} onBeforeCompile={leafWindShader} /></instancedMesh>
    </group>;
}

// park floor: no flat green between tufts - value noise plus fine blade streaks in world space, so the gaps read as grass undergrowth (ref: BotW grassland ground mottling)
const floorGrass = (sh: any) => {
    sh.vertexShader = 'varying vec2 vFx;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vFx = (modelMatrix * vec4(position, 1.0)).xz;');
    sh.uniforms.uDayG = TOD.day; sh.fragmentShader = 'varying vec2 vFx; uniform float uDayG;\nfloat fh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat fn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(fh(i), fh(i + vec2(1.0, 0.0)), f.x), mix(fh(i + vec2(0.0, 1.0)), fh(i + vec2(1.0, 1.0)), f.x), f.y); }\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n float m1 = sin(vFx.x * 0.21) * sin(vFx.y * 0.17), m2 = sin(vFx.x * 1.1 + vFx.y * 0.8) * sin(vFx.y * 1.3 - vFx.x * 0.4); diffuseColor.rgb *= 0.88 + 0.07 * m1 + 0.04 * m2; diffuseColor.rgb *= mix(vec3(0.66, 0.9, 1.1), vec3(1.0), uDayG); ');
};
// meadow: long grass tufts + subtle flowers + fireflies. Reference study: instanced blade-cluster grass with wind sway in the vertex shader (common real-time approach, e.g. GDC "Ghost of Tsushima" grass talk, three.js instanced grass guides); blade shapes, colours and placement are mine
const INK_R = 2;
const GR_POOL = (() => { let r = 4242; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647; const cx = (PARK.x0 + PARK.x1) / 2, cz = (PARK.z0 + PARK.z1) / 2; const a: number[] = []; for (let i = 0; i < 39000; i++) { const x = PARK.x0 + 3 + rnd() * (PARK.x1 - PARK.x0 - 6), z = PARK.z0 + 3 + rnd() * (PARK.z1 - PARK.z0 - 6); const pond = ((x - PARK_POND.cx) / (PARK_POND.rx + 1.5)) ** 2 + ((z - PARK_POND.cz) / (PARK_POND.rz + 1.5)) ** 2; if (Math.abs((x - cx) - (z - cz) * 0.6) < 6.5 || Math.hypot(x - cx, z - cz) < 4 || pond < 1.0 || bridgeSurfaceAt(x, z) !== null || sandWeight(x, z) > 0.35) continue; a.push(x, z, rnd(), rnd()); } return a; })();
// shared park assets (South Sea island reuses them: Shifat 5:49 PM "reuse the parks assets")
export function parkBushGeo(){
        const gs:THREE.BufferGeometry[]=[];let r=73;const rnd=()=>(r=r*16807%2147483647)/2147483647;
        // Isolate scanned leaf silhouettes, excluding packed stem/bark atlas triangles.
        const boxes=[[224,0,357,184],[102,205,248,396],[360,195,482,372],[371,59,459,181]];
        for(let i=0;i<48;i++) {const bx=boxes[i%boxes.length],w=(bx[2]-bx[0])/512,h=(bx[3]-bx[1])/512;const len=0.5+rnd()*0.5;
            const g=new THREE.PlaneGeometry(len*w/h,len);g.translate(0,len/2,0);const uv=g.attributes.uv;for(let k=0;k<4;k++)uv.setXY(k,bx[0]/512+uv.getX(k)*w,1-bx[3]/512+uv.getY(k)*h);
            const a=i*2.39996,rad=0.1+0.6*Math.sqrt(rnd());g.rotateZ((rnd()-0.5)*1.3);g.rotateY(a);g.translate(Math.cos(a)*rad,0.02+rnd()*0.65,Math.sin(a)*rad);gs.push(g);
        }return mergeGeometries(gs,false)!;
    }
export function parkGrassOnCompile(uni: { uTime: { value: number }; uHero: { value: THREE.Vector3 }; uCam: { value: THREE.Vector3 } }) { return (sh: any) => { sh.uniforms.uTime = uni.uTime; sh.uniforms.uHero = uni.uHero; sh.uniforms.uCam = uni.uCam; sh.vertexShader = 'uniform float uTime; uniform vec3 uHero; uniform vec3 uCam;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n float hh = position.y; transformed.y *= mix(0.4, 1.0, smoothstep(0.9, 3.8, length(instanceMatrix[3].xz - uHero.xz))) * mix(0.3, 1.0, smoothstep(1.5, 5.5, length(instanceMatrix[3].xz - uCam.xz))); float wv = sin(uTime * 0.9 + instanceMatrix[3].x * 0.07 + instanceMatrix[3].z * 0.045) * 0.5 + 0.5; transformed.x += (sin(uTime * 1.5 + instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.22) * 0.1 + wv * 0.38) * hh * hh; transformed.y -= wv * 0.12 * hh * hh; transformed.z += cos(uTime * 1.2 + instanceMatrix[3].z * 0.3) * 0.1 * hh * hh; vHt = clamp(position.y / 0.9, 0.0, 1.0);').replace('void main() {', 'varying float vHt;\nvoid main() {');
    // grass optics (ref: BotW grassland, blades dark at the root and sun-lit translucent yellow-green at the tips): base occlusion, bright backlit tips, soft sheen
    sh.uniforms.uDayG = TOD.day; sh.fragmentShader = 'varying float vHt; uniform float uDayG;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight *= mix(0.8, 1.15, vHt); outgoingLight *= mix(vec3(0.62, 0.86, 1.12), vec3(1.0), uDayG); outgoingLight += mix(vec3(0.05, 0.11, 0.2), vec3(0.25, 0.32, 0.17), uDayG) * vHt * vHt * 0.32; diffuseColor.a = 0.5;\n#include <opaque_fragment>\ngl_FragColor.a = 0.25;'); };   // env-iter3: OPAQUE forced alpha back to 1.0 after the old 0.5, so blades were inked one by one; 0.25 = grass class for the outline pass
}
const GR_NEAR = 22;
export function tuftGeo(segN = 8) {
    const pos: number[] = [], col: number[] = []; let r = 5; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    for (let b = 0; b < 7; b++) {
        const a = rnd() * 6.28, ox = (rnd() - 0.5) * 0.35, oz = (rnd() - 0.5) * 0.35, h = 0.8 + rnd() * 0.7, w = 0.035 + rnd() * 0.025, lean = (0.3 + rnd() * 0.45) * h;
        const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
        // Eight curved segments provide a smooth blade arc before the vertex shader adds the wind bend.
        const segments = segN;
        const point = (t: number, side: number) => {
            const curve = 0.14 * Math.sin(t * Math.PI) + 0.86 * t * t;
            const width = w * (1 - 0.9 * t) * side;
            return [ox + dx * lean * curve + px * width, h * t, oz + dz * lean * curve + pz * width];
        };
        const vertex = (v: number[]) => {
            pos.push(v[0], v[1], v[2]);
            const k = v[1] / h;
            col.push(0.34 + 0.36 * k, 0.47 + 0.31 * k, 0.29 + 0.19 * k);
        };
        for (let j = 0; j < segments; j++) {
            const t0 = j / segments, t1 = (j + 1) / segments;
            const left0 = point(t0, -1), right0 = point(t0, 1), left1 = point(t1, -1), right1 = point(t1, 1);
            [left0, right0, left1, right0, right1, left1].forEach(vertex);
        }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
}
// env-iter3: meadow flowers share the grass outline class (alpha 0.25), so they are part of the one meadow silhouette
const grassTag = (sh: any) => { sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a = 0.25;'); };
const FL_COL = ['#8a5cf0', '#4f7cff', '#e03a4a', '#ff7fb8'];
export function Meadow({ sim }: { sim: Sim }) {
    const gr = useRef<THREE.InstancedMesh>(null!), fl = useRef<THREE.InstancedMesh>(null!), ff = useRef<THREE.Points>(null!), last = useRef([1e9, 1e9]), uni = useRef({ uTime: { value: 0 }, uHero: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() } }), fu = useRef({ uTime: { value: 0 } });
    useFrame((st) => { if (ff.current && ff.current.layers.mask !== 3) ff.current.layers.enable(SELECTIVE_BLOOM_LAYER); uni.current.uHero.value.set(sim.pos[0], sim.pos[1], sim.pos[2]); uni.current.uCam.value.copy(st.camera.position); if (DBG && gr.current) (window as any).__polyforkGrass = { outlineMaskAlpha: gr.current.userData.outlineMaskAlpha, outlineMaskThreshold: gr.current.userData.outlineMaskThreshold, bladeSegments: 8 }; const m = gr.current && (gr.current.material as THREE.MeshLambertMaterial); if (m) m.emissive.set('#1c3410').multiplyScalar(0.12 + 0.88 * TOD.day.value); });   // tuft self-light follows the day level so grass does not glow at night
    const geo = useMemo(() => tuftGeo(8), []), geoF = useMemo(() => tuftGeo(3), []);   /* far tufts (> GR_NEAR m from the hero): 3-segment blades - a few pixels tall from there, ~60% fewer grass triangles in the park */
    const grF = useRef<THREE.InstancedMesh>(null!);
    const flGeo = useMemo(() => { const g = new THREE.CircleGeometry(0.17, 7); g.rotateX(-Math.PI / 2.4); g.translate(0, 0.62, 0); const st = new THREE.PlaneGeometry(0.02, 0.62); st.translate(0, 0.31, 0); return mergeGeometries([g, st], false)!; }, []);
    const ffGeo = useMemo(() => { const n = 90, p = new Float32Array(n * 3), ph = new Float32Array(n); let r = 99; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647; for (let i = 0; i < n; i++) { p[i * 3] = PARK.x0 + 10 + rnd() * (PARK.x1 - PARK.x0 - 20); p[i * 3 + 2] = PARK.z0 + 10 + rnd() * (PARK.z1 - PARK.z0 - 20); p[i * 3 + 1] = 0.8 + rnd() * 5 + parkH(p[i * 3], p[i * 3 + 2]); ph[i] = rnd() * 6.28; } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('ph', new THREE.BufferAttribute(ph, 1)); return g; }, []);
    const place = (hx: number, hz: number) => {
        const o = new THREE.Object3D(), col = new THREE.Color(); let gi = 0, fi = 0;
        let gf = 0;
        for (let i = 0; i < GR_POOL.length && gi + gf < QK.grass; i += 4) {
            const x = GR_POOL[i], z = GR_POOL[i + 1], dh = Math.hypot(x - hx, z - hz); if (dh > QK.grassRadius || bridgeSurfaceAt(x, z) !== null) continue; const far = dh > GR_NEAR, gm = far ? grF.current : gr.current, gk = far ? gf++ : gi++;
            o.position.set(x, 0.05 + parkH(x, z), z); o.rotation.set(0, GR_POOL[i + 2] * 6.28, 0); const cl = Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.09), sc = (1.0 + GR_POOL[i + 3] * 0.7) * (1 + 0.4 * cl) * (1 + 0.04 * Math.max(0, -parkH(x, z)));   o.scale.set(sc, sc, sc); o.updateMatrix(); gm.setMatrixAt(gk, o.matrix); gm.setColorAt(gk, col.setHSL(0.22 + GR_POOL[i + 3] * 0.1 - 0.045 * cl + 0.03 * Math.sin(x * 0.045 + z * 0.06), 0.30 + 0.06 * cl, 0.34 + GR_POOL[i + 2] * 0.10 + 0.065 * cl));
            if (GR_POOL[i + 2] < 0.12 && fi < 420) { o.position.set(x + 0.2, 0.05 + parkH(x + 0.2, z), z); o.scale.setScalar(0.8 + GR_POOL[i + 3] * 0.6); o.updateMatrix(); fl.current.setMatrixAt(fi, o.matrix); fl.current.setColorAt(fi++, col.set(FL_COL[Math.floor(GR_POOL[i + 3] * 4) % 4])); }
        }
        gr.current.count = gi; grF.current.count = gf; fl.current.count = fi; [gr.current, grF.current, fl.current].forEach((m) => { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); if(m.boundingSphere) m.boundingSphere.radius += 0.7; });
    };
    useFrame((st) => { uni.current.uTime.value = fu.current.uTime.value = st.clock.elapsedTime; const hx = sim.pos[0], hz = sim.pos[2]; if (Math.hypot(hx - last.current[0], hz - last.current[1]) > 8) { last.current = [hx, hz]; place(hx, hz); } });
    const onGrass = parkGrassOnCompile(uni.current);
    const grMat = useMemo(() => { const m = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color('#1c3410'), side: THREE.DoubleSide }); m.onBeforeCompile = onGrass; return m; }, []);   // one material (one program) for near + far tufts
    return <group>
        <instancedMesh ref={gr} name="polyfork-curved-grass-blades" userData={{ outlineMaskAlpha: 0.5, outlineMaskThreshold: 0.75 }} args={[geo, grMat, QK.grass]} frustumCulled={true} />
        <instancedMesh ref={grF} name="polyfork-curved-grass-blades-far" userData={{ outlineMaskAlpha: 0.5, outlineMaskThreshold: 0.75 }} args={[geoF, grMat, QK.grass]} frustumCulled={true} />
        <instancedMesh ref={fl} args={[flGeo, undefined, 420]}><meshLambertMaterial emissive="#555555" side={THREE.DoubleSide} onBeforeCompile={grassTag} /></instancedMesh>
        <points ref={ff} geometry={ffGeo} frustumCulled={false}><shaderMaterial transparent depthWrite={false} blending={THREE.AdditiveBlending} uniforms={fu.current} vertexShader={`uniform float uTime; attribute float ph; varying float vA; varying vec3 vOrbCol; void main(){ vOrbCol=0.58+0.42*cos(ph+vec3(0.0,2.1,4.2)); vec3 p = position; p.x += sin(uTime*0.4+ph*3.0)*2.5; p.z += cos(uTime*0.35+ph*2.0)*2.5; p.y += sin(uTime*0.7+ph)*0.8; vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv; vA = 0.35+0.65*pow(0.5+0.5*sin(uTime*1.6+ph*5.0),2.0); gl_PointSize = clamp(38.0/(-mv.z), 2.0, 9.0); }`} fragmentShader={`varying float vA;varying vec3 vOrbCol;void main(){float d=length(gl_PointCoord-0.5);float a=smoothstep(0.5,0.0,d);gl_FragColor=vec4(vOrbCol*(0.7+0.3*a),a*a*vA);}`} /></points>
    </group>;
}


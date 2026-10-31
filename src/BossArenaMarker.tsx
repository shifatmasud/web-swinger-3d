import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BOSS_ARENA } from './sim';
import { SELECTIVE_BLOOM_LAYER } from './renderLayers';

const DBG = !!(import.meta as any).env.VITE_DBG;

/* Upgrade #2 (Oct 29): the beam used to be a near-opaque red tube that hid the boss standing inside it.
   Now a see-through energy column: bright fresnel rim, clear centre, faded near the roof (so the boss reads
   clearly) and at the top, with slow rising bands. Additive, so it still glows from across the city. */
const BEAM_MAT = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPulse: { value: 0.5 }, uCol: { value: new THREE.Color('#ff1030') } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
        void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); vY = position.y / 84.0 + 0.5; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform float uTime; uniform float uPulse; uniform vec3 uCol; varying vec3 vN; varying vec3 vV; varying float vY;
        void main(){ float f = 1.0 - abs(dot(normalize(vN), vV)); float rim = pow(f, 2.2);
            float bands = 0.5 + 0.5 * sin(vY * 70.0 - uTime * 3.0);
            float a = (0.07 + rim * 0.85) * (0.75 + 0.25 * bands) * (0.8 + 0.4 * uPulse);
            a *= smoothstep(0.02, 0.17, vY) * (1.0 - smoothstep(0.82, 1.0, vY));
            gl_FragColor = vec4(uCol * (0.6 + rim * 0.9), a); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
});


export function BossArenaMarker({ arena = BOSS_ARENA }: { arena?: { x: number; y: number; z: number } }) {   // 2c: also marks Neon Harbor's mini-boss roof (same red zone)
    const root = useRef<THREE.Group>(null!);
    const beam = useRef<THREE.Mesh>(null!);
    const core = useRef<THREE.Mesh>(null!);
    const ring = useRef<THREE.Mesh>(null!);

    const small = useRef<THREE.Mesh>(null!);
    useFrame(({ clock, camera }) => {
        /* 25 fps pass: frustum culling back on (was off on every piece: drawn even behind you, twice with bloom); the small roof rings and core are
           sub-pixel past 350 m, so they are skipped there - the tall beam still marks the arena from across the city */
        if (root.current) { const near = camera.position.distanceTo(root.current.position) < 350; if (core.current) core.current.visible = near; if (ring.current) ring.current.visible = near; if (small.current) small.current.visible = near; }
        const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 2.4);
        BEAM_MAT.uniforms.uTime.value = clock.elapsedTime; BEAM_MAT.uniforms.uPulse.value = pulse;
        if (core.current) {
            (core.current.material as THREE.MeshBasicMaterial).opacity = 0.72 + pulse * 0.24;
            core.current.scale.setScalar(0.92 + pulse * 0.12);
        }
        if (ring.current) (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.42 + pulse * 0.23;
        if (DBG && arena === BOSS_ARENA) (window as any).__bossArenaMarker = root.current;
    });

    return <group ref={root} position={[arena.x, arena.y, arena.z]} userData={{ bossArena: true }}>
        <mesh ref={beam} onUpdate={(o) => o.layers.enable(SELECTIVE_BLOOM_LAYER)} position={[0, 42, 0]}>
            <cylinderGeometry args={[3.5, 3.5, 84, 24, 1, true]} />
            <primitive object={BEAM_MAT} attach="material" />
        </mesh>
        <mesh ref={core} onUpdate={(o) => o.layers.enable(SELECTIVE_BLOOM_LAYER)} position={[0, 83, 0]}>
            <icosahedronGeometry args={[2.1, 1]} />
            <meshBasicMaterial color="#fff1f4" transparent opacity={0.86} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
        </mesh>
        <mesh ref={ring} onUpdate={(o) => o.layers.enable(SELECTIVE_BLOOM_LAYER)} position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[7.4, 7.95, 48]} />
            <meshBasicMaterial color="#d40020" transparent opacity={0.72} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} fog={false} />
        </mesh>
        <mesh ref={small} onUpdate={(o) => o.layers.enable(SELECTIVE_BLOOM_LAYER)} position={[0, 1.7, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[5.6, 0.11, 6, 32]} />
            <meshBasicMaterial color="#d40020" transparent opacity={0.78} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} />
        </mesh>
    </group>;
}

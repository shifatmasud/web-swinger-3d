import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useRef } from 'react';
import { TOD, UW, UWF } from './env';
import { waterMat } from '../water/oceanMaterial';
import { FOG } from '../sim';

const DBG = !!(import.meta as any).env.VITE_DBG;   // test hooks only in instrumented builds

// Day/night cycle: drives the shared TOD uniforms (sun, fog, warmth) and the sea's colours over a 5-minute loop.
const DN_DUR = 300, DN_PH0 = Math.asin(0.22 / 0.95);
const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _cn = new THREE.Color(0.035, 0.055, 0.13), _cnoon = new THREE.Color(0.76, 0.84, 0.93), _cwarm = new THREE.Color(FOG[0], FOG[1], FOG[2]);
const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _uwDay = new THREE.Color();
export function DayNight() {
    const { scene } = useThree();
    const ls = useRef<{ h: THREE.HemisphereLight; a: THREE.DirectionalLight; b: THREE.DirectionalLight } | null>(null);
    useFrame((st) => {
        if (!ls.current) { const h = scene.getObjectByName('hemi'), a = scene.getObjectByName('sun1'), b = scene.getObjectByName('sun2'); if (!h || !a || !b) return; ls.current = { h: h as THREE.HemisphereLight, a: a as THREE.DirectionalLight, b: b as THREE.DirectionalLight }; }
        let ph = DN_PH0 + (st.clock.elapsedTime / DN_DUR) * Math.PI * 2; if (DBG && (window as any).__todPh !== undefined) ph = (window as any).__todPh;
        TOD.sun.set(-0.5, Math.sin(ph) * 0.95, Math.cos(ph) * 0.85 + 0.3).normalize();
        const sy = TOD.sun.y, day = sstep(-0.12, 0.3, sy), warm = 1 - sstep(0.25, 0.7, sy);
        if (DBG) (window as any).__tod = { sy, day, warm, fog: TOD.fog.toArray() }; TOD.day.value = day; TOD.warm.value = warm; TOD.noon.value = sstep(0.3, 0.95, sy);
        _c1.copy(_cnoon).lerp(_cwarm, warm).lerp(_cn, 1 - day); TOD.fog.copy(_c1); TOD.sky.copy(_c1).lerp(_c2.set('#c4dcef'), 0.3 * day);
        if (!UW.on) (scene.background as THREE.Color).copy(_c1);
        UWF.value.set('#0e3a5e').lerp(_uwDay.set('#1a7f9c'), day);   /* Shifat 2:31 PM 'dive too dark, colourless': moonlit deep blue at night (was 20% of the day teal = near black), clearer turquoise by day */
        { const wu = waterMat.uniforms, k = 0.16 + 0.84 * day; wu.uDeep.value.set('#0a6f92').multiplyScalar(k); wu.uShallow.value.set('#2fa8c4').multiplyScalar(k); }   // water body colour follows the light level (sky reflection already follows TOD.sky)
        const { h, a, b } = ls.current;
        h.color.set('#d4e4ff').lerp(_c2.set('#3a4c8c'), 1 - day); h.intensity = 0.5 + 0.75 * day;
        const up = sy > 0;
        a.position.set(TOD.sun.x * 70 * (up ? 1 : -1), Math.abs(TOD.sun.y) * 70 + 8, TOD.sun.z * 70 * (up ? 1 : -1));
        a.color.set('#fff6ea').lerp(_c2.set('#ffd2a0'), warm).lerp(_c2.set('#ff9a5a'), sstep(0.0, 0.2, 0.2 - sy) * day * 0.7).lerp(_c2.set('#8fb0ff'), 1 - day); a.intensity = 0.5 + 1.3 * day * (1 - 0.4 * TOD.noon.value);
        b.intensity = 0.25 + 0.55 * day;
    });
    return null;
}


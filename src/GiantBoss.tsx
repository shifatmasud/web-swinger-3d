import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import heroData from './hero.json';
import baseTexUrl from './basetex';
import { BOSS_BODY_OFFSET, BOSS_ROOT_SCALE, BOSS_SCALE_FACTOR, SHADOW_ROOT_SCALE } from './bossConfig';
import type { Sim } from './sim';
import { SELECTIVE_BLOOM_LAYER } from './renderLayers';

const DBG = !!(import.meta as any).env.VITE_DBG;
const SOURCE_HERO = JSON.parse(JSON.stringify(heroData)) as any;

type BossRig = {
    root: THREE.Group;
    body: THREE.SkinnedMesh;
    bones: THREE.Bone[];
    byName: Record<string, THREE.Bone>;
    geometry: THREE.BufferGeometry;
    skin: THREE.MeshLambertMaterial;
    outline: THREE.MeshBasicMaterial;
    muscleGeometry: THREE.SphereGeometry;
    muscleMaterial: THREE.MeshLambertMaterial;
    muscleOutline: THREE.MeshLambertMaterial;
    armorGeometry: THREE.DodecahedronGeometry;
    armorSphereGeometry: THREE.SphereGeometry;
    armorBandGeometry: THREE.CylinderGeometry;
    armorMaterial: THREE.MeshLambertMaterial;
    armorTrimMaterial: THREE.MeshLambertMaterial;
    eyeMaterial: THREE.MeshBasicMaterial;
    armorMeshes: THREE.Mesh[];
    thrusterGroup: THREE.Group;
    thrusterOuterGeometry: THREE.ConeGeometry;
    thrusterCoreGeometry: THREE.ConeGeometry;
    thrusterOuterMaterial: THREE.MeshBasicMaterial;
    thrusterCoreMaterial: THREE.MeshBasicMaterial;
    thrusterOuter: THREE.Mesh[];
    thrusterCore: THREE.Mesh[];
};

function smoothstep(a: number, b: number, x: number) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

function muscularShadowGeometry(data: any) {
    const positions = new Float32Array(data.pos);
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i], y = positions[i + 1], z = positions[i + 2];
        const ax = Math.abs(x);
        const torso = smoothstep(0.88, 1.10, y) * (1 - smoothstep(1.62, 1.78, y)) * (1 - smoothstep(0.28, 0.40, ax));
        const chest = Math.exp(-Math.pow((y - 1.42) / 0.23, 2));
        const shoulders = Math.exp(-Math.pow((y - 1.58) / 0.25, 2));
        const arms = smoothstep(0.25, 0.35, ax) * smoothstep(0.82, 1.02, y) * (1 - smoothstep(1.63, 1.76, y));
        const thighs = smoothstep(0.08, 0.16, ax) * smoothstep(0.22, 0.34, y) * (1 - smoothstep(0.78, 0.96, y));

        // Keep Shadow's mesh and joints, with a pronounced athletic chest, shoulders, and limbs.
        positions[i] = x * (1 + torso * (0.14 + chest * 0.12) + arms * (0.18 + shoulders * 0.12) + thighs * 0.14);
        positions[i + 2] = z * (1 + arms * 0.25 + thighs * 0.16) + (z > 0 ? torso * chest * 0.09 : 0);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(data.si, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(data.sw, 4));
    geometry.setIndex(data.idx);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.muscleProfile = { torsoWidth: 1.26, upperArmBulk: 1.30, thighBulk: 1.14 };
    return geometry;
}

function redArmorUnderlayMaterial() {
    const material = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#101010', emissiveIntensity: 0.08 });
    new THREE.TextureLoader().load(baseTexUrl, (source) => {
        const image = source.image as HTMLImageElement;
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) { source.dispose(); return; }
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = pixels.data;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
            const lens = b > g * 1.55 && r > g * 1.18 && b > r * 1.12 && b > 72;
            if (lens) {
                const shade = 0.84 + 0.16 * (luminance / 255);
                data[i] = 255 * shade; data[i + 1] = 20 * shade; data[i + 2] = 32 * shade;
            } else {
                const shade = 0.72 + 0.28 * (luminance / 255);
                data[i] = 106 * shade; data[i + 1] = 16 * shade; data[i + 2] = 29 * shade;
            }
        }
        ctx.putImageData(pixels, 0, 0);
        const painted = new THREE.CanvasTexture(canvas);
        painted.flipY = false; painted.colorSpace = THREE.SRGBColorSpace; painted.anisotropy = 2;
        material.map = painted; material.needsUpdate = true;
        source.dispose();
    });
    return material;
}

function addMuscle(parent: THREE.Bone, name: string, position: [number, number, number], size: [number, number, number], geometry: THREE.SphereGeometry, material: THREE.MeshLambertMaterial, outline: THREE.MeshLambertMaterial) {
    const form = new THREE.Group(); form.name = name; form.position.set(...position); parent.add(form);
    const ink = new THREE.Mesh(geometry, outline); ink.name = `${name}-outline`; ink.scale.set(size[0] * 1.09, size[1] * 1.09, size[2] * 1.09);
    const muscle = new THREE.Mesh(geometry, material); muscle.name = name; muscle.scale.set(...size);
    form.add(ink, muscle);
}

function buildBossRig(): BossRig {
    const data = SOURCE_HERO;
    const geometry = muscularShadowGeometry(data);
    const skin = redArmorUnderlayMaterial();
    const body = new THREE.SkinnedMesh(geometry, skin);
    body.name = 'giant-boss-shadow-body'; body.frustumCulled = false;
    body.userData.shadowBody = true;
    body.userData.muscularProfile = geometry.userData.muscleProfile;

    const bones: THREE.Bone[] = [], byName: Record<string, THREE.Bone> = {};
    data.bones.forEach((description: any, i: number) => {
        const bone = new THREE.Bone(); bone.name = description.n; bones.push(bone); byName[description.n] = bone;
        const parent = description.p >= 0 ? data.bones[description.p].h : [0, 0, 0];
        bone.position.set(description.h[0] - parent[0], description.h[1] - parent[1], description.h[2] - parent[2]);
        if (description.p >= 0) bones[description.p].add(bone);
    });
    body.add(bones[0]);

    const muscleGeometry = new THREE.SphereGeometry(1, 14, 10);
    const muscleMaterial = new THREE.MeshLambertMaterial({ color: '#69121f', emissive: '#160208', emissiveIntensity: 0.08 });
    const outline = new THREE.MeshBasicMaterial({ color: '#0a0d1a', side: THREE.BackSide });
    outline.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', 'transformed += normalize(objectNormal) * 0.014;\n#include <project_vertex>');
    };
    outline.customProgramCacheKey = () => 'shadow-boss-outline-v1';
    const muscleOutline = new THREE.MeshLambertMaterial({ color: '#090a12', emissive: '#07080e', emissiveIntensity: 0.25, side: THREE.BackSide });
    muscleOutline.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', 'transformed += normalize(objectNormal) * 0.014;\n#include <project_vertex>');
    };
    muscleOutline.customProgramCacheKey = () => 'shadow-boss-muscle-outline-v1';

    const armorGeometry = new THREE.DodecahedronGeometry(1, 0);
    const armorSphereGeometry = new THREE.SphereGeometry(1, 12, 8);
    const armorBandGeometry = new THREE.CylinderGeometry(1, 0.82, 1, 10, 1);
    const armorMaterial = new THREE.MeshLambertMaterial({ color: '#c92338', emissive: '#27030a', emissiveIntensity: 0.12 });
    const armorTrimMaterial = new THREE.MeshLambertMaterial({ color: '#74111f', emissive: '#190207', emissiveIntensity: 0.08 });
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: '#ff1d32' });
    const armorMeshes: THREE.Mesh[] = [];
    const plate = (parent: THREE.Bone, part: string, position: [number, number, number], size: [number, number, number], material = armorMaterial, shape: THREE.BufferGeometry = armorGeometry) => {
        const mesh = new THREE.Mesh(shape, material);
        mesh.name = `boss-armor-${part}-${armorMeshes.length}`;
        mesh.position.set(...position); mesh.scale.set(...size);
        mesh.userData.bossArmor = true; mesh.userData.armorPart = part;
        parent.add(mesh); armorMeshes.push(mesh); return mesh;
    };

    for (const side of [-1, 1]) {
        const label = side < 0 ? 'left' : 'right';
        addMuscle(byName.chest, `boss-pec-${label}`, [side * 0.105, 0.045, 0.15], [0.12, 0.074, 0.052], muscleGeometry, muscleMaterial, muscleOutline);
        for (const [row, y] of [-0.12, -0.215, -0.31].entries()) {
            addMuscle(byName.chest, `boss-ab-${row}-${label}`, [side * 0.047, y, 0.142], [0.045, 0.036, 0.026], muscleGeometry, muscleMaterial, muscleOutline);
        }
        addMuscle(byName[side < 0 ? 'uarmL' : 'uarmR'], `boss-deltoid-${label}`, [0, 0.005, 0.035], [0.105, 0.09, 0.10], muscleGeometry, muscleMaterial, muscleOutline);
        addMuscle(byName[side < 0 ? 'uarmL' : 'uarmR'], `boss-bicep-${label}`, [0, -0.13, 0.065], [0.092, 0.14, 0.10], muscleGeometry, muscleMaterial, muscleOutline);
        addMuscle(byName[side < 0 ? 'thighL' : 'thighR'], `boss-quad-${label}`, [side * 0.045, -0.18, 0.035], [0.082, 0.17, 0.095], muscleGeometry, muscleMaterial, muscleOutline);
    }

    // The open-faced helmet keeps Shadow's original red lens pixels unobstructed.
    plate(byName.head, 'helmet', [0, 0.12, 0.035], [0.125, 0.065, 0.14], armorTrimMaterial, armorSphereGeometry);
    for (const side of [-1, 1]) {
        plate(byName.head, 'helmet', [side * 0.095, 0.015, 0.12], [0.04, 0.12, 0.15], armorMaterial, armorSphereGeometry);
        plate(byName.head, 'helmet', [side * 0.075, -0.105, 0.22], [0.05, 0.05, 0.10], armorTrimMaterial, armorSphereGeometry);
    }
    plate(byName.head, 'helmet', [0, 0.095, 0.31], [0.093, 0.025, 0.045], armorMaterial);
    plate(byName.head, 'helmet', [0, -0.13, 0.23], [0.085, 0.04, 0.09], armorMaterial);
    for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(armorSphereGeometry, eyeMaterial);
        eye.name = `boss-original-red-eye-${side < 0 ? 'left' : 'right'}`;
        eye.position.set(side * 0.032, 0.044, 0.335); eye.scale.set(0.019, 0.012, 0.006);
        eye.userData.bossEyeLens = true; eye.layers.enable(SELECTIVE_BLOOM_LAYER); byName.head.add(eye);
    }
    plate(byName.neck, 'neck', [0, 0.035, 0], [0.135, 0.10, 0.135], armorTrimMaterial, armorBandGeometry);

    plate(byName.chest, 'chest', [0, 0.045, 0.13], [0.36, 0.27, 0.13]);
    for (const side of [-1, 1]) plate(byName.chest, 'chest', [side * 0.15, 0.075, 0.205], [0.18, 0.13, 0.075], armorMaterial, armorSphereGeometry);
    plate(byName.chest, 'chest', [0, -0.035, 0.232], [0.075, 0.20, 0.055], armorTrimMaterial);
    plate(byName.chest, 'back', [0, 0.045, -0.135], [0.31, 0.25, 0.105], armorTrimMaterial, armorSphereGeometry);
    plate(byName.spine, 'abdomen', [0, 0.035, 0.145], [0.23, 0.16, 0.085]);
    plate(byName.spine, 'abdomen', [0, -0.095, 0.14], [0.205, 0.095, 0.08], armorTrimMaterial);

    plate(byName.hips, 'pelvis', [0, -0.045, 0.045], [0.27, 0.16, 0.17], armorTrimMaterial, armorSphereGeometry);
    plate(byName.hips, 'pelvis', [0, -0.04, 0.15], [0.205, 0.12, 0.085]);
    plate(byName.hips, 'pelvis', [0, -0.14, 0], [0.26, 0.075, 0.24], armorTrimMaterial, armorBandGeometry);
    for (const side of [-1, 1]) plate(byName.hips, 'pelvis', [side * 0.205, -0.025, 0.035], [0.11, 0.15, 0.135]);

    for (const side of [-1, 1]) {
        const upper = byName[side < 0 ? 'uarmL' : 'uarmR'];
        const fore = byName[side < 0 ? 'farmL' : 'farmR'];
        const hand = byName[side < 0 ? 'handL' : 'handR'];
        plate(upper, 'shoulder', [0, 0.01, 0.005], [0.205, 0.175, 0.19]);
        plate(upper, 'upper-arm', [0, -0.155, 0], [0.125, 0.16, 0.125], armorTrimMaterial, armorBandGeometry);
        plate(upper, 'upper-arm', [0, -0.145, 0.082], [0.115, 0.16, 0.072]);
        plate(upper, 'elbow', [0, -0.305, 0.025], [0.13, 0.085, 0.125], armorMaterial, armorSphereGeometry);
        plate(fore, 'forearm', [0, -0.14, 0], [0.108, 0.15, 0.108], armorTrimMaterial, armorBandGeometry);
        plate(fore, 'forearm', [0, -0.135, 0.072], [0.11, 0.16, 0.075]);
        plate(hand, 'gauntlet', [0, -0.005, 0.045], [0.11, 0.09, 0.13]);
        plate(hand, 'gauntlet', [0, 0.015, 0.105], [0.078, 0.055, 0.055], armorTrimMaterial);
    }

    for (const side of [-1, 1]) {
        const thigh = byName[side < 0 ? 'thighL' : 'thighR'];
        const shin = byName[side < 0 ? 'shinL' : 'shinR'];
        const foot = byName[side < 0 ? 'footL' : 'footR'];
        plate(thigh, 'thigh', [0, -0.22, 0], [0.145, 0.23, 0.14], armorTrimMaterial, armorBandGeometry);
        plate(thigh, 'thigh', [0, -0.205, 0.075], [0.13, 0.205, 0.078]);
        plate(shin, 'knee', [0, 0.005, 0.03], [0.145, 0.105, 0.13], armorMaterial, armorSphereGeometry);
        plate(shin, 'shin', [0, -0.22, 0], [0.12, 0.23, 0.12], armorTrimMaterial, armorBandGeometry);
        plate(shin, 'shin', [0, -0.215, 0.075], [0.115, 0.22, 0.078]);
        plate(foot, 'boot', [0, -0.02, 0.07], [0.145, 0.095, 0.205]);
        plate(foot, 'boot', [0, -0.055, 0.135], [0.12, 0.048, 0.10], armorTrimMaterial);
    }

    const root = new THREE.Group(); root.add(body); root.updateMatrixWorld(true);
    body.bind(new THREE.Skeleton(bones));
    const ink = new THREE.SkinnedMesh(geometry, outline);
    ink.name = 'giant-boss-shadow-outline'; ink.frustumCulled = false;
    root.add(ink); ink.bind(body.skeleton, body.bindMatrix);

    const thrusterGroup = new THREE.Group(); thrusterGroup.name = 'boss-thrusters'; thrusterGroup.visible = false; thrusterGroup.userData.bossThrusterCue = true;
    const thrusterOuterGeometry = new THREE.ConeGeometry(0.085, 0.52, 8);
    const thrusterCoreGeometry = new THREE.ConeGeometry(0.045, 0.36, 8);
    const thrusterOuterMaterial = new THREE.MeshBasicMaterial({ color: '#51dfff', transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
    const thrusterCoreMaterial = new THREE.MeshBasicMaterial({ color: '#f4fdff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const thrusterOuter: THREE.Mesh[] = [], thrusterCore: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
        const suffix = side < 0 ? 'left' : 'right';
        const outer = new THREE.Mesh(thrusterOuterGeometry, thrusterOuterMaterial); outer.name = `boss-thruster-outer-${suffix}`;
        outer.position.set(side * 0.115, -0.28, 0.015); outer.userData.bossThruster = true; outer.frustumCulled = false;
        const core = new THREE.Mesh(thrusterCoreGeometry, thrusterCoreMaterial); core.name = `boss-thruster-core-${suffix}`;
        core.position.set(side * 0.115, -0.22, 0.018); core.userData.bossThruster = true; core.frustumCulled = false;
        thrusterGroup.add(outer, core); thrusterOuter.push(outer); thrusterCore.push(core);
    }
    root.add(thrusterGroup);

    root.userData = { giantBoss: true, bodyModel: 'Shadow hero mesh', scaleFactor: BOSS_SCALE_FACTOR, shadowRootScale: SHADOW_ROOT_SCALE, bodyOffset: BOSS_BODY_OFFSET, armorMeshCount: armorMeshes.length, armorCoverage: [...new Set(armorMeshes.map((mesh) => mesh.userData.armorPart))] };
    return { root, body, bones, byName, geometry, skin, outline, muscleGeometry, muscleMaterial, muscleOutline, armorGeometry, armorSphereGeometry, armorBandGeometry, armorMaterial, armorTrimMaterial, eyeMaterial, armorMeshes, thrusterGroup, thrusterOuterGeometry, thrusterCoreGeometry, thrusterOuterMaterial, thrusterCoreMaterial, thrusterOuter, thrusterCore };
}

const _bossS = new THREE.Sphere(new THREE.Vector3(), 22), _bossM = new THREE.Matrix4(), _bossF = new THREE.Frustum();
export function GiantBoss({ sim, mini = false }: { sim: Sim; mini?: boolean }) {
    const rig = useMemo(buildBossRig, []);
    const root = rig.root;
    const state = useRef({ x: 0, z: 0, phase: 0, ready: false });

    useEffect(() => () => {
        rig.geometry.dispose(); rig.skin.map?.dispose(); rig.skin.dispose(); rig.outline.dispose();
        rig.muscleGeometry.dispose(); rig.muscleMaterial.dispose(); rig.muscleOutline.dispose();
        rig.armorGeometry.dispose(); rig.armorSphereGeometry.dispose(); rig.armorBandGeometry.dispose(); rig.armorMaterial.dispose(); rig.armorTrimMaterial.dispose(); rig.eyeMaterial.dispose();
        rig.thrusterOuterGeometry.dispose(); rig.thrusterCoreGeometry.dispose(); rig.thrusterOuterMaterial.dispose(); rig.thrusterCoreMaterial.dispose();
    }, [rig]);

    useFrame((_st, rawDt) => {
        const dt = Math.max(0.001, Math.min(0.05, rawDt));
        const boss = sim.enemies.find((e) => e.boss && !!(e as any).mini === mini);   // South Sea 4: a second rig draws Neon Harbor's mini-boss
        if (!boss || sim.mode !== 'play') { root.visible = false; return; }
        /* Shifat 9:43 AM 'freeze what's not visible': each boss rig is ~40 separate meshes (armour, muscles, eyes, thrusters, outlines) = ~40 draw calls.
           Off-screen or past 260 m (a few pixels on a phone) the whole rig is hidden and its pose update skipped. */
        { const cam = _st.camera; _bossS.center.set(boss.x, boss.y + 8, boss.z); _bossM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _bossF.setFromProjectionMatrix(_bossM);
          if (cam.position.distanceTo(_bossS.center) > 260 || !_bossF.intersectsSphere(_bossS)) { root.visible = false; return; } }
        if (DBG && !mini) (window as any).__giantBossRoot = root;

        const motion = state.current;
        const speed = motion.ready ? Math.hypot(boss.x - motion.x, boss.z - motion.z) / dt : 0;
        motion.x = boss.x; motion.z = boss.z; motion.ready = true;
        const moving = Math.max(0, Math.min(1, speed / 1.8));
        motion.phase += dt * (1.45 + Math.min(1.1, speed * 0.65));
        const stride = Math.sin(motion.phase);
        const attackT = boss.atk > 0 ? Math.max(0, Math.min(1, 1 - boss.atk / 1.3)) : 0;
        const hit = boss.hit > 0 ? Math.min(0.06, boss.hit * 0.04) : 0;
        const fall = boss.down > 0 ? Math.max(0, Math.min(1, (3 - boss.down) / 0.55)) : 0;
        const b = rig.byName;
        const flightPhase = boss.flight?.phase ?? 'grounded';
        const flightPower = boss.down > 0 || boss.hit > 0 ? 0 : flightPhase === 'takeoff' ? 0.9 : flightPhase === 'hover' ? 0.52 : flightPhase === 'propel' ? 1 : flightPhase === 'landing' ? 0.34 : 0;
        const plume = flightPower * (0.9 + 0.1 * Math.sin(sim.t * 27));
        rig.thrusterGroup.visible = plume > 0.05;
        rig.thrusterGroup.userData.phase = flightPhase; rig.thrusterGroup.userData.power = plume;
        rig.thrusterOuterMaterial.opacity = 0.18 + plume * 0.58; rig.thrusterCoreMaterial.opacity = 0.22 + plume * 0.72;
        rig.thrusterOuter.forEach((mesh) => { mesh.scale.y = 0.45 + plume * 0.75; });
        rig.thrusterCore.forEach((mesh) => { mesh.scale.y = 0.45 + plume * 0.65; });

        root.visible = true;
        root.position.set(boss.x, boss.y + ((boss as any).ly || 0), boss.z);
        root.rotation.set(-fall * 0.18, boss.ang, fall * 0.76);
        root.scale.setScalar(BOSS_ROOT_SCALE * (mini ? 0.72 : 1) * Math.max(0.002, 1 - fall * 0.78));

        rig.bones.forEach((bone) => bone.rotation.set(0, 0, 0));
        const airborne = flightPhase !== 'grounded';
        b.thighL.rotation.x = stride * 0.22 * moving - (airborne ? 0.22 : 0);
        b.thighR.rotation.x = -stride * 0.22 * moving - (airborne ? 0.22 : 0);
        b.shinL.rotation.x = airborne ? 0.42 : Math.max(0, -stride) * 0.28 * moving;
        b.shinR.rotation.x = airborne ? 0.42 : Math.max(0, stride) * 0.28 * moving;
        b.uarmL.rotation.x = -stride * 0.12 * moving;
        b.uarmR.rotation.x = stride * 0.12 * moving;
        if (airborne) { b.uarmL.rotation.z = -0.08; b.uarmR.rotation.z = 0.08; }
        b.chest.rotation.x = 0.018 + Math.sin(sim.t * 1.1) * 0.012;
        b.chest.rotation.z = Math.sin(motion.phase * 0.5) * 0.018 * moving;
        b.head.rotation.x = -0.025 + Math.sin(motion.phase - 0.5) * 0.025 * moving;
        if (boss.atk > 0) {
            const lift = attackT < 0.55 ? attackT / 0.55 : 1 - (attackT - 0.55) / 0.45;
            b.uarmR.rotation.x = attackT < 0.55 ? 0.64 * lift : 0.64 - 1.68 * (1 - lift);
            b.farmR.rotation.x = -0.38 * lift;
            b.chest.rotation.x = attackT < 0.55 ? 0.08 + lift * 0.12 : 0.2 - (1 - lift) * 0.38;
        }
        rig.skin.color.setRGB(1 + hit, 1 + hit, 1 + hit);
    });

    return <primitive object={root} visible={false} frustumCulled={false} />;
}

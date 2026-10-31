import React, { useEffect, useMemo, useRef } from 'react';
import { registerHero } from './heroHD';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import heroData from './hero.json';
import baseTexUrl from './basetex';
import { buildings, parkH, SNARE, stepSim, setCompanionSim, type Events, type Input, type Sim } from './sim';
import { animateHeroBones, applyHeroRootPose, buildRig, createCombatPoseState, createHeroClipState, SNARE_PULSE_SEGMENTS, SNARE_RING_SEGMENTS, writeSnarePulse, writeSnareRing, type CombatPoseState, type HeroClipState, type HeroRootPoseState } from './Scene';
import { BOSS_BODY_OFFSET } from './bossConfig';
import { HERO_REFL } from './caustics';

const DBG = !!(import.meta as any).env.VITE_DBG;
const HERO_SCALE = 1.5;
const GHOST_SNARE_COLOR = '#ff1a96';
const BODY_OFF = [0.8, 0.3, 1.05, 1.7];
const enemyBodyOffset = (e: Sim['enemies'][number]) => e.boss ? BOSS_BODY_OFFSET : BODY_OFF[e.kind ?? 0];
const SILENT: Events = {
    orb: () => {}, fall: () => {}, attach: () => {}, release: () => {}, jump: () => {},
    hit: () => {}, hurt: () => {}, ko: () => {}, land: () => {}, blast: () => {},
};
const _target = new THREE.Vector3();
const _handL = new THREE.Vector3();
const _handR = new THREE.Vector3();

/* Upgrade #1 (Shifat OK'd 9:16 PM Oct 29, effect only, model untouched): round soft sprite for Ghost's point FX — they drew as hard squares. */
const SOFT_DOT = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')!; const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.85)'); g.addColorStop(0.7, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();

function feminineHeroData() {
    const d = JSON.parse(JSON.stringify(heroData)) as any;
    const p: number[] = d.pos;
    const gauss = (y: number, center: number, width: number) => Math.exp(-(((y - center) / width) ** 2));
    for (let i = 0; i < p.length; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        // A small, smooth torso-only shape change: fuller hips, a defined waist,
        // and narrower shoulders. The mesh, suit panels and bone hierarchy stay Shadow's.
        const torsoWeight = Math.max(0, 1 - Math.abs(x) / 0.34);
        const hip = 1 + 0.13 * gauss(y, 0.92, 0.15);
        const waist = 1 - 0.20 * gauss(y, 1.18, 0.15);
        const chest = 1 - 0.07 * gauss(y, 1.52, 0.16);
        const factor = 1 + ((y < 1.06 ? hip : y < 1.36 ? waist : chest) - 1) * torsoWeight;
        p[i] = x * factor;
        if (Math.abs(x) < 0.27 && z > 0) p[i + 2] += 0.025 * torsoWeight * gauss(y, 1.38, 0.17);
    }
    d.rebuildNormals = true;
    return d;
}

function recoloredSuitMaterial() {
    let mat!: THREE.MeshLambertMaterial;
    const tex = new THREE.TextureLoader().load(baseTexUrl, (source) => {
        const image = source.image as HTMLImageElement;
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = pixels.data;
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const lum = r * 0.2126 + g * 0.7152 + b * 0.0722;
            const goldTrim = r > g * 1.10 && g > b * 1.06 && r > 55;
            const purpleLens = b > g * 1.55 && r > g * 1.18 && b > r * 1.12 && b > 72;
            if (purpleLens) {
                // Keep the lens texture's shading, but shift its purple hue to hot pink.
                const shade = 0.82 + 0.18 * (lum / 255);
                data[i] = 255 * shade; data[i + 1] = 26 * shade; data[i + 2] = 150 * shade;
            } else if (lum < 142 && !goldTrim) {
                // Lift Shadow's dark suit panels to white while preserving the original
                // grayscale weave, creases and gold trim rather than adding new armor.
                const shade = 0.80 + 0.20 * (lum / 142);
                data[i] = 250 * shade; data[i + 1] = 252 * shade; data[i + 2] = 255 * shade;
            }
        }
        ctx.putImageData(pixels, 0, 0);
        const painted = new THREE.CanvasTexture(canvas);
        painted.flipY = false; painted.colorSpace = THREE.SRGBColorSpace; painted.anisotropy = 16;
        mat.map = painted; mat.emissiveMap = painted; mat.needsUpdate = true;
        source.dispose();
    });
    tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 16;   // hero texture: full anisotropy (three clamps to the GPU max)
    mat = new THREE.MeshLambertMaterial({ map: tex, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.45 });
    return mat;
}

function makeGhostRig() {
    const suit = recoloredSuitMaterial();
    const rig = buildRig(feminineHeroData(), suit);
    rig.root.name = 'ghost-human-companion';
    rig.root.scale.setScalar(HERO_SCALE);
    rig.root.visible = false;
    return { ...rig, suit };
}

function floorAt(x: number, z: number) {
    let y = parkH(x, z);
    for (const b of buildings) if (x > b.x0 + 0.25 && x < b.x1 - 0.25 && z > b.z0 + 0.25 && z < b.z1 - 0.25 && b.h > y) y = b.h;
    return y;
}

function nearbyGroundPoint(sim: Sim, preferX: number, preferZ: number): [number, number, number] {
    const surface = sim.pos[1] - 1, dx = preferX - sim.pos[0], dz = preferZ - sim.pos[2], base = Math.atan2(dz, dx);
    const radii = [Math.hypot(dx, dz), 2.6, 2.1, 1.6, 1.1, 0.65, 0];
    for (const r of radii) for (let i = 0; i < (r === 0 ? 1 : 16); i++) {
        const a = i === 0 ? base : base + i * Math.PI * 2 / 16, x = sim.pos[0] + Math.cos(a) * r, z = sim.pos[2] + Math.sin(a) * r, y = floorAt(x, z);
        if (Math.abs(y - surface) <= 0.9) return [x, y + 1, z];
    }
    return [sim.pos[0], sim.pos[1], sim.pos[2]];
}

function nearbyWallPoint(sim: Sim, wall: [number, number], x: number, y: number, z: number): [number, number, number] {
    const b = buildings[sim.wallB]; if (!b) return [x, y, z];
    const clamp = (v: number, lo: number, hi: number) => hi >= lo ? Math.max(lo, Math.min(hi, v)) : (lo + hi) * 0.5;
    if (Math.abs(wall[0]) > Math.abs(wall[1])) { x = sim.pos[0]; z = clamp(z, b.z0 + 1.1, b.z1 - 1.1); }
    else { z = sim.pos[2]; x = clamp(x, b.x0 + 1.1, b.x1 - 1.1); }
    y = clamp(y, 1.2, Math.max(1.3, b.h - 0.65));
    return [x, y, z];
}

function makeControls(): Input {
    return { attackQ: false, dodgeQ: false, mx: 0, my: 0, swing: false, keys: {}, jumpQ: false, swingQ: false, grabQ: false, shotQ: false, meleeQ: false, specialQ: false, jumpHeld: false, jumpReleased: false, jumpCancelled: false, glide: false };
}

function makeActor(leader: Sim, at: [number, number, number]): Sim {
    const actor = { ...leader, pos: [...at] as [number, number, number], vel: [0, 0, 0] as [number, number, number],
        enemies: leader.enemies, orbs: [], plasma: [], blasts: [], anchor: [0, 0, 0] as [number, number, number],
        safe: [...at] as [number, number, number], mode: 'play' as const, ground: true, web: false,
        anchorReal: false, spring: 0, shotT: 0, shotTgt: [0, 0, 0] as [number, number, number], shotE: null,
        glideOn: false, swim: false, dive: false, wall: null, wallB: -1, wallT: 0, vaulted: 0,
        hp: 100, hurtT: 0, atkT: 0, dodgeT: 0, combo: 0, comboT: 0, kos: 0, score: 0,
        land: 0, landHard: 0, lastHit: -9, swings: 0, maxSpeed: 0, runPhase: 0, lastDrag: -10,
        aimE: null, atkPend: 0, webT: 0, rope: 20, airT: 0, grappleFlight: false, webDepartB: undefined,
        yaw: leader.ang, pitch: leader.pitch, ang: leader.ang, t: leader.t, time: leader.time } as Sim;
    for (const key of ['mv', 'mvQ', 'flip', 'chain', 'chainT', 'snareT', 'snareCd', 'snareList', 'cWeb', 'windT', 'hitStop']) delete (actor as any)[key];
    (actor as any).snareCd = 0;
    return actor;
}

function resetControls(c: Input) {
    c.attackQ = c.dodgeQ = c.jumpQ = c.swingQ = false;
    c.grabQ = c.shotQ = c.meleeQ = c.specialQ = false;
    c.jumpHeld = c.jumpReleased = c.jumpCancelled = false;
    c.mx = c.my = 0; c.swing = false; c.glide = false;
    for (const key of Object.keys(c.keys)) delete c.keys[key];
}

function selectTarget(actor: Sim) {
    let best: Sim['enemies'][number] | null = null, bestD = 24, count = 0;
    for (const e of actor.enemies) {
        if (e.down > 0) continue;
        const d = Math.hypot(e.x - actor.pos[0], e.z - actor.pos[2]);
        const dy = Math.abs(e.y + ((e as any).ly || 0) + enemyBodyOffset(e) - actor.pos[1]);
        if (d < 25 && dy < 16) count++;
        if (d < bestD && dy < 16) { best = e; bestD = d; }
    }
    return { enemy: best, distance: best ? bestD : Infinity, count };
}

function hasLiveShadowAction(sim: Sim) {
    const s = sim as any, speed = Math.hypot(sim.vel[0], sim.vel[1], sim.vel[2]);
    return !!(s.mv || s.flip || s.snareT > 0 || sim.web || sim.spring > 0 || sim.grappleFlight || sim.glideOn || sim.swim || sim.wall || sim.wallT > 0 || sim.atkT > 0 || sim.shotT > 0 || sim.dodgeT > 0 || !sim.ground || sim.land > 0 || speed > 0.6);
}

function animateHuman(actor: Sim, rig: ReturnType<typeof buildRig>, dt: number, state: any, driver: Sim = actor) {
    const root = rig.root;
    const shadowRootPose = driver !== actor ? (driver as any).__heroRootPoseState as HeroRootPoseState | undefined : undefined;
    const rootPose = applyHeroRootPose(driver, rig, dt, state, actor.pos, HERO_SCALE, shadowRootPose, driver === actor);
    const shadowClipState = driver !== actor ? (driver as any).__heroClipState as HeroClipState | undefined : undefined;
    const shadowPoseState = driver !== actor ? (driver as any).__heroPoseState as CombatPoseState | undefined : undefined;
    if (shadowPoseState) { state.pose.w = shadowPoseState.w; state.pose.c.set(shadowPoseState.c); state.pose.t.set(shadowPoseState.t); }
    const animation = animateHeroBones(driver, rig, dt, { clipState: state.anim as HeroClipState, poseState: state.pose as CombatPoseState, sourceClipState: shadowClipState, poseDt: shadowClipState ? 0 : dt, glideBlend: rootPose.glideBlend, publishState: driver === actor });
    root.updateMatrixWorld(true);
    rig.skel.update();
    return { ...animation, source: driver === actor ? 'ghost' : 'shadow' };
}

const MORPH_PARTICLES = 96;
function makeMorphGeometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MORPH_PARTICLES * 3), 3));
    const colors = new Float32Array(MORPH_PARTICLES * 3);
    const pink = new THREE.Color('#ff45ad'), white = new THREE.Color('#fff7ff');
    for (let i = 0; i < MORPH_PARTICLES; i++) (i % 3 === 0 ? pink : white).toArray(colors, i * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setDrawRange(0, 0);
    return geometry;
}

function setRigOpacity(root: THREE.Object3D, opacity: number) {
    root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
            if (material.opacity === undefined) continue;
            material.opacity = opacity;
            const tr = opacity < 0.999;   // 25 fps pass: only recompile when transparency actually flips (was every frame -> a program lookup per material per frame)
            if (material.transparent !== tr) { material.transparent = tr; material.needsUpdate = true; }
            material.depthWrite = !tr;
        }
    });
}

function updateMorphParticles(geometry: THREE.BufferGeometry, material: THREE.PointsMaterial, morph: { phase: 'out' | 'in'; t: number; from: [number, number, number]; to: [number, number, number]; seed: number }) {
    const duration = morph.phase === 'out' ? 0.32 : 0.38;
    const k = Math.max(0, Math.min(1, morph.t / duration)), eased = k * k * (3 - 2 * k);
    const expanding = morph.phase === 'out', center = expanding ? morph.from : morph.to;
    const radius = expanding ? eased : 1 - eased;
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < MORPH_PARTICLES; i++) {
        const angle = i * 2.399963 + morph.seed + morph.t * 3.8;
        const r = 0.18 + radius * (2.2 + (i % 5) * 0.34);
        const lift = (i % 12) * 0.14 + radius * 1.8;
        positions.setXYZ(i, center[0] + Math.cos(angle) * r, center[1] + lift + Math.sin(angle * 0.7) * 0.18, center[2] + Math.sin(angle) * r);
    }
    positions.needsUpdate = true;
    geometry.setDrawRange(0, MORPH_PARTICLES);
    material.opacity = expanding ? 0.9 : 0.9 * (1 - eased);
}

export function GhostCompanion({ sim }: { sim: Sim }) {
    const model = useMemo(makeGhostRig, []);
    useEffect(() => registerHero(model.root), [model]);   // Ghost joins the hero HD pass
    const actorRef = useRef<Sim | null>(null);
    const controls = useMemo(makeControls, []);
    const lineGeo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(72 * 3), 3)); return g; }, []);
    const shockGeo = useMemo(() => { const cap = SNARE.MAX_TARGETS * (2 * SNARE_PULSE_SEGMENTS + SNARE_RING_SEGMENTS), g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 2 * 3), 3)); return g; }, []);
    const plasmaGeo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3)); g.setDrawRange(0, 0); return g; }, []);
    const morphGeo = useMemo(makeMorphGeometry, []);
    const lineRef = useRef<THREE.LineSegments>(null!);
    const shockRef = useRef<THREE.LineSegments>(null!);
    const lineMatRef = useRef<THREE.LineBasicMaterial>(null!);
    const shockMatRef = useRef<THREE.LineBasicMaterial>(null!);
    const plasmaRef = useRef<THREE.Points>(null!);
    const morphRef = useRef<THREE.Points>(null!);
    const morphMatRef = useRef<THREE.PointsMaterial>(null!);
    const state = useRef({ ready: false, wallSyncB: -1, leaderSurfaceSeen: false, leaderGround: false, leaderWallB: -1, leaderWall: null as [number, number] | null, lastVaulted: 0, vaultUntil: -1, gB: 0, bYaw: undefined as number | undefined, bR: 0, floorY: 0, floorX: 1e9, floorZ: 1e9, floorT: -1, attackAt: 0, shotAt: 0, jumpAt: 0, swingAt: 0, specialAt: 0, dodgeAt: 0,
        morph: { active: false, phase: 'out' as 'out' | 'in', t: 0, from: [0, 0, 0] as [number, number, number], to: [0, 0, 0] as [number, number, number], seed: 0, reason: '' },
        anim: createHeroClipState(), pose: createCombatPoseState() });

    useFrame((_, rawDt) => {
        const dt = Math.min(0.05, rawDt), st = state.current, root = model.root;
        if (sim.mode !== 'play') {
            root.visible = false; st.ready = false; actorRef.current = null; setCompanionSim(null);
            st.morph.active = false; setRigOpacity(root, 1); root.scale.setScalar(HERO_SCALE);
            st.leaderSurfaceSeen = false; st.leaderWall = null; st.leaderWallB = -1; st.lastVaulted = 0; st.vaultUntil = -1;
            st.attackAt = st.shotAt = st.jumpAt = st.swingAt = st.specialAt = st.dodgeAt = 0;
            st.anim.key = ''; st.anim.t = 0; st.anim.w = 0; st.pose.w = 0; st.pose.c.fill(0); st.pose.t.fill(0);
            if (lineRef.current) lineRef.current.visible = false;
            if (shockRef.current) shockRef.current.visible = false;
            shockGeo.setDrawRange(0, 0);
            if (plasmaRef.current) plasmaRef.current.visible = false;
            if (morphRef.current) morphRef.current.visible = false;
            morphGeo.setDrawRange(0, 0);
            HERO_REFL.ghost.w = 0;   /* reflection trace: Ghost hidden */
            if (DBG) (window as any).__ghostState = { visible: false, mode: sim.mode };
            return;
        }
        const fx = Math.sin(sim.ang), fz = Math.cos(sim.ang), rx = -fz, rz = fx;
        let tx = sim.pos[0] - fx * 1.45 + rx * 2.6;
        let tz = sim.pos[2] - fz * 1.45 + rz * 2.6;
        const leaderWall = sim.wall && !sim.swim ? sim.wall as [number, number] : null;
        const leaderAir = sim.glideOn || sim.grappleFlight || sim.spring > 0 || (!sim.ground && !sim.web && !sim.wall && !sim.swim);
        const wallEntered = !!leaderWall && st.leaderSurfaceSeen && (!st.leaderWall || st.leaderWallB !== sim.wallB || Math.hypot(leaderWall[0] - st.leaderWall[0], leaderWall[1] - st.leaderWall[1]) > 0.25);
        const landed = !!(st.leaderSurfaceSeen && sim.ground && !st.leaderGround);
        const surfaceTransition = landed || wallEntered;
        const vaulted = (sim as any).vaulted || 0;
        if (vaulted !== st.lastVaulted) { st.lastVaulted = vaulted; if (vaulted > 0 && !leaderWall) st.vaultUntil = sim.t + 0.75; }
        st.leaderSurfaceSeen = true; st.leaderGround = !!sim.ground;
        st.leaderWall = leaderWall ? [...leaderWall] as [number, number] : null;
        st.leaderWallB = leaderWall ? sim.wallB : -1;
        if (!leaderWall) st.wallSyncB = -1;
        const airborneLeader = !sim.ground && !sim.wall && !sim.swim;
        let ty: number;
        if (sim.ground && !sim.web && !sim.wall && !sim.swim) {
            if (sim.t - st.floorT > 0.3 || Math.hypot(tx - st.floorX, tz - st.floorZ) > 2) {
                st.floorY = floorAt(tx, tz); st.floorX = tx; st.floorZ = tz; st.floorT = sim.t;
            }
            ty = st.floorY + 1;
        } else ty = sim.swim ? sim.pos[1] : sim.pos[1] - (airborneLeader ? 0.25 : 0);
        if (leaderWall) {
            const txWall = -leaderWall[1], tzWall = leaderWall[0];
            const lateral = sim.vel[0] * txWall + sim.vel[2] * tzWall;
            if (Math.abs(lateral) > 1) { tx = sim.pos[0] - Math.sign(lateral) * txWall * 2.8; tz = sim.pos[2] - Math.sign(lateral) * tzWall * 2.8; }
            else { tx = sim.pos[0]; tz = sim.pos[2]; }
            ty = sim.pos[1] - (Math.abs(sim.vel[1]) > 0.6 ? Math.sign(sim.vel[1]) * 2.6 : 2.4);
            [tx, ty, tz] = nearbyWallPoint(sim, leaderWall, tx, ty, tz);
        }
        if (surfaceTransition && sim.ground && !leaderWall && !sim.swim) [tx, ty, tz] = nearbyGroundPoint(sim, tx, tz);

        _target.set(tx, ty, tz);
        if (!actorRef.current) actorRef.current = makeActor(sim, [tx, ty, tz]);
        const actor = actorRef.current;
        actor.mode = 'play'; actor.t = sim.t; actor.time = sim.time; actor.enemies = sim.enemies;
        actor.safe[0] = tx; actor.safe[1] = ty; actor.safe[2] = tz;
        setCompanionSim(actor);
        resetControls(controls);
        const independentSnare = (sim as any).snareT > 0 || (actor as any).snareT > 0;
        const animationSource = !independentSnare && (hasLiveShadowAction(sim) || sim.t < st.vaultUntil) ? sim : actor;
        const toLeader = Math.hypot(actor.pos[0] - sim.pos[0], actor.pos[1] - sim.pos[1], actor.pos[2] - sim.pos[2]);
        const targetDistance = Math.hypot(tx - actor.pos[0], ty - actor.pos[1], tz - actor.pos[2]);
        if (!st.ready) {
            actor.pos[0] = tx; actor.pos[1] = ty; actor.pos[2] = tz;
            actor.vel[0] = actor.vel[1] = actor.vel[2] = 0;
            actor.web = false; actor.wall = null; actor.ground = true; actor.swim = false;
            actor.ang = sim.ang; actor.yaw = sim.ang; st.ready = true;
        } else if (!st.morph.active && (toLeader > 42 || surfaceTransition || (leaderWall && st.wallSyncB !== sim.wallB && targetDistance > 10))) {
            st.morph.active = true; st.morph.phase = 'out'; st.morph.t = 0;
            st.morph.from = [actor.pos[0], actor.pos[1], actor.pos[2]];
            st.morph.to = [tx, ty, tz]; st.morph.seed = sim.t * 2.1;
            st.morph.reason = wallEntered ? 'wall-entry' : landed ? 'ground-landing' : toLeader > 42 ? 'distance-catch-up' : 'wall-resync';
            if (leaderWall) st.wallSyncB = sim.wallB;
        }
        if (st.morph.active) {
            st.morph.t += dt;
            if (st.morph.phase === 'out' && st.morph.t >= 0.32) {
                actor.pos[0] = st.morph.to[0]; actor.pos[1] = st.morph.to[1]; actor.pos[2] = st.morph.to[2];
                actor.vel[0] = actor.vel[1] = actor.vel[2] = 0;
                actor.web = false; actor.wall = leaderWall ? [...leaderWall] as [number, number] : null; actor.wallB = leaderWall ? sim.wallB : -1;
                actor.ground = !leaderWall && !leaderAir; actor.swim = false; actor.dive = false; actor.glideOn = false; actor.airT = leaderAir ? 0.34 : 0; actor.wallT = 0;
                if (leaderAir) { actor.ground = false; actor.vel[1] = 2.5; }
                actor.ang = leaderWall ? sim.ang : sim.ang; actor.yaw = sim.ang;
                st.morph.phase = 'in'; st.morph.t = 0;
            } else if (st.morph.phase === 'in' && st.morph.t >= 0.38) {
                st.morph.active = false; setRigOpacity(root, 1); root.scale.setScalar(HERO_SCALE);
            }
        }
        if (st.morph.active) {
            const animation = animateHuman(actor, model, dt, st, animationSource);
            root.visible = true;
            const k = Math.max(0, Math.min(1, st.morph.t / (st.morph.phase === 'out' ? 0.32 : 0.38))), eased = k * k * (3 - 2 * k);
            const bodyOpacity = st.morph.phase === 'out' ? 1 - eased : eased;
            setRigOpacity(root, bodyOpacity);
            root.scale.setScalar(HERO_SCALE * (0.82 + 0.18 * (st.morph.phase === 'out' ? 1 - eased : eased)));
            if (morphRef.current && morphMatRef.current) { morphRef.current.visible = true; updateMorphParticles(morphGeo, morphMatRef.current, st.morph); }
            if (lineRef.current) lineRef.current.visible = false;
            if (shockRef.current) shockRef.current.visible = false;
            shockGeo.setDrawRange(0, 0);
            if (plasmaRef.current) plasmaRef.current.visible = false;
            HERO_REFL.ghost.set(actor.pos[0], actor.pos[1], actor.pos[2], 1);   /* reflection trace only; model/material untouched */
            if (DBG) (window as any).__ghostState = { visible: true, mode: sim.mode, position: [...actor.pos], target: [tx, ty, tz], action: 'transport', leaderTraversal: leaderWall ? 'wall' : sim.web ? 'swing' : leaderAir ? 'glide' : 'ground', ghostTraversal: 'transport', transport: st.morph.phase, morphReason: st.morph.reason, morphT: st.morph.t, morphFrom: [...st.morph.from], morphTo: [...st.morph.to], bodyOpacity, particles: MORPH_PARTICLES, grounded: actor.ground, wallB: actor.wallB, leaderWall: !!leaderWall, leaderWallB: leaderWall ? sim.wallB : -1, targetSupportY: leaderWall ? null : floorAt(st.morph.to[0], st.morph.to[2]), leaderSurfaceY: leaderWall ? null : sim.pos[1] - 1, animation };
            return;
        }
        if (morphRef.current) morphRef.current.visible = false;
        morphGeo.setDrawRange(0, 0);

        const choice = selectTarget(actor), enemy = choice.enemy;
        const enemyD = choice.distance;
        const fighting = !!enemy && enemyD < 23;
        if (leaderWall) {
            actor.wall = [...leaderWall] as [number, number]; actor.wallB = sim.wallB; actor.wallT = 0;
            actor.ground = false; actor.web = false; actor.swim = false; actor.glideOn = false; actor.airT = 0;
        }
        const gx = fighting && enemy ? enemy.x : tx, gz = fighting && enemy ? enemy.z : tz;
        const gy = fighting && enemy ? enemy.y + ((enemy as any).ly || 0) + enemyBodyOffset(enemy) : ty;
        const dx = gx - actor.pos[0], dz = gz - actor.pos[2], goalD = Math.hypot(dx, dz);
        const destYaw = Math.atan2(dx, dz);
        actor.yaw = leaderWall ? sim.ang : destYaw;
        if (leaderWall) {
            const wallDx = tx - actor.pos[0], wallDy = ty - actor.pos[1], wallDz = tz - actor.pos[2];
            const rightX = -Math.cos(actor.yaw), rightZ = Math.sin(actor.yaw);
            controls.my = Math.max(-1, Math.min(1, wallDy / 2.2));
            controls.mx = Math.max(-1, Math.min(1, (wallDx * rightX + wallDz * rightZ) / 2.2));
        } else if (goalD > 2.4) { controls.my = 1; }
        if (fighting && enemyD < 3.5 && enemy && enemy.atk > 0.18 && actor.dodgeT <= 0 && sim.t >= st.dodgeAt) {
            controls.dodgeQ = true; controls.mx = (enemy.x - actor.pos[0]) >= 0 ? -0.65 : 0.65; controls.my = -0.7; st.dodgeAt = sim.t + 1.1;
        }
        const longRoute = Math.hypot(tx - actor.pos[0], tz - actor.pos[2]) > 12 || goalD > 15;
        if (sim.web) {
            controls.swing = true;
            if (!actor.web) controls.swingQ = true;
        } else if (longRoute && !actor.web && !actor.swim && !leaderWall && !leaderAir && sim.t >= st.swingAt) {
            if (!actor.ground && !actor.wall) { controls.swingQ = true; controls.swing = true; st.swingAt = sim.t + 1.2; }
            else if (goalD > 22) { controls.grabQ = true; st.swingAt = sim.t + 1.8; }
        }
        if (actor.web && !sim.web && goalD > 8 && longRoute && !leaderAir) controls.swing = true;
        if (actor.web && !sim.web && (!longRoute || goalD < 7 || leaderAir)) controls.swing = false;
        if (leaderAir) {
            controls.swing = false; controls.jumpHeld = true;
            if (!actor.glideOn && (actor.ground || actor.wall || actor.web)) { actor.airT = 0.34; controls.jumpQ = true; }
        } else if (longRoute && actor.ground && !actor.swim && !leaderWall && !sim.web && sim.t >= st.jumpAt) {
            controls.jumpQ = true; st.jumpAt = sim.t + 0.7;
        } else if (longRoute && actor.web && !sim.web && sim.t >= st.jumpAt) {
            controls.jumpQ = true; st.jumpAt = sim.t + 1.0;
        }
        if (actor.swim && sim.swim && actor.dive !== sim.dive && sim.t >= st.jumpAt) { controls.jumpQ = true; st.jumpAt = sim.t + 1.0; }

        if (fighting && enemy && !((actor as any).snareT > 0) && !(DBG && (window as any).__ghostDisableCombat)) {
            const lifted = ((enemy as any).ly || 0) > 1.1 || ((enemy as any).vy || 0) > 1.2;
            const useSpecial = choice.count >= 2 && (actor as any).snareCd <= 0 && sim.t >= st.specialAt;
            if (useSpecial) { controls.specialQ = true; st.specialAt = sim.t + 9.2; }
            else if (lifted && enemyD < 22 && sim.t >= st.attackAt) {
                controls.attackQ = true; controls.shotQ = true; st.attackAt = sim.t + 0.48;
            } else if (enemyD < 16 && sim.t >= st.attackAt) {
                controls.attackQ = true; controls.meleeQ = true; st.attackAt = sim.t + 0.48;
            } else if (enemyD < 34 && sim.t >= st.shotAt) {
                controls.attackQ = true; controls.shotQ = true; st.shotAt = sim.t + 1.6;
            }
        }

        if (DBG && (window as any).__ghostForceSpecial) {
            controls.attackQ = controls.shotQ = controls.meleeQ = false;
            controls.specialQ = true;
            (window as any).__ghostForceSpecial = false;
        }
        for (let i = 0; i < 2; i++) stepSim(actor, dt / 2, SILENT, controls, { updateEnemies: false });
        if (leaderAir) actor.vel[1] += Math.max(-8, Math.min(8, (ty - actor.pos[1]) * 0.32 - actor.vel[1] * 0.65)) * dt;
        const animation = animateHuman(actor, model, dt, st, animationSource);
        root.visible = true;

        const pa = plasmaGeo.attributes.position as THREE.BufferAttribute;
        const bolts = actor.plasma.slice(0, 24);
        for (let i = 0; i < bolts.length; i++) pa.setXYZ(i, bolts[i].x, bolts[i].y, bolts[i].z);
        plasmaGeo.setDrawRange(0, bolts.length); pa.needsUpdate = true;
        if (plasmaRef.current) plasmaRef.current.visible = bolts.length > 0;

        const la = lineGeo.attributes.position as THREE.BufferAttribute, xa = shockGeo.attributes.position as THREE.BufferAttribute; let n = 0, webHandMask = 0, pulseSegments = 0, ringSegments = 0, snareWebLines = 0, pulseProgress = 0;
        const webSource = animationSource, webState = webSource as any;
        if (webSource.web || webSource.spring > 0 || webState.snareT > 0) {
            model.root.updateMatrixWorld(true);
            model.b.handL.getWorldPosition(_handL); model.b.handR.getWorldPosition(_handR);
            if (webSource.web || webSource.spring > 0) {
                const bothHands = webSource.spring > 0, swingSide = webSource.swings % 2;
                if (bothHands || swingSide === 0) {
                    la.setXYZ(n * 2, _handL.x, _handL.y, _handL.z); la.setXYZ(n * 2 + 1, webSource.anchor[0], webSource.anchor[1], webSource.anchor[2]); n++;
                    webHandMask |= 1;
                }
                if (bothHands || swingSide === 1) {
                    la.setXYZ(n * 2, _handR.x, _handR.y, _handR.z); la.setXYZ(n * 2 + 1, webSource.anchor[0], webSource.anchor[1], webSource.anchor[2]); n++;
                    webHandMask |= 2;
                }
            }
            const targets = (webState.snareList || []) as Sim['enemies'];
            const sn = webState.snareT || 0;
            for (let i = 0; i < Math.min(5, targets.length); i++) {
                const e = targets[i]; if (e.down > 0) continue;
                const ty = e.y + ((e as any).ly || 0) + enemyBodyOffset(e);
                la.setXYZ(n * 2, _handL.x, _handL.y, _handL.z); la.setXYZ(n * 2 + 1, e.x, ty, e.z); n++;
                la.setXYZ(n * 2, _handR.x, _handR.y, _handR.z); la.setXYZ(n * 2 + 1, e.x, ty, e.z); n++; snareWebLines += 2;
                if (sn > SNARE.IMPACT && sn <= SNARE.SHOCK_START) { const p = 1 - (sn - SNARE.IMPACT) / (SNARE.SHOCK_START - SNARE.IMPACT); pulseProgress = p; pulseSegments = writeSnarePulse(xa, pulseSegments, _handL.x, _handL.y, _handL.z, e.x, ty, e.z, p, i * 3.1); pulseSegments = writeSnarePulse(xa, pulseSegments, _handR.x, _handR.y, _handR.z, e.x, ty, e.z, p, i * 3.1 + 1.7); }
                if (sn > 0 && sn <= SNARE.IMPACT) { const p = 1 - sn / SNARE.IMPACT; ringSegments = writeSnareRing(xa, ringSegments, e.x, ty, e.z, 0.35 + p * 1.75); }
            }
        }
        lineGeo.setDrawRange(0, n * 2); la.needsUpdate = true;
        if (lineRef.current) lineRef.current.visible = n > 0;
        shockGeo.setDrawRange(0, (pulseSegments + ringSegments) * 2); xa.needsUpdate = true;
        if (shockRef.current) shockRef.current.visible = pulseSegments + ringSegments > 0;
        const ownSnare = (actor as any).snareT > 0;
        if (lineMatRef.current) lineMatRef.current.color.set(ownSnare ? GHOST_SNARE_COLOR : '#d8f5ff');
        if (shockMatRef.current) shockMatRef.current.color.set(ownSnare ? GHOST_SNARE_COLOR : '#ffffff');
        if (DBG) (window as any).__ghostState = {
            visible: true, mode: sim.mode, position: [...actor.pos], target: [tx, ty, tz], speed: Math.hypot(actor.vel[0], actor.vel[1], actor.vel[2]),
            leaderDistance: Math.hypot(actor.pos[0] - sim.pos[0], actor.pos[1] - sim.pos[1], actor.pos[2] - sim.pos[2]),
            enemyDistance: enemyD, targetId: enemy ? sim.enemies.indexOf(enemy) : -1,
            action: ((actor as any).mv || (actor as any).snareT > 0) ? 'combat' : actor.wall ? 'wall' : actor.web ? 'swing' : actor.glideOn ? 'glide' : actor.swim ? 'swim' : 'follow',
            animation,
            morphReason: st.morph.reason, surfaceTransition, landed, wallEntered, leaderGround: !!sim.ground, leaderWall: !!leaderWall, leaderWallB: leaderWall ? sim.wallB : -1,
            leaderTraversal: leaderWall ? 'wall' : sim.web ? 'swing' : leaderAir ? 'glide' : sim.swim ? 'swim' : 'ground',
            ghostTraversal: actor.wall ? 'wall' : actor.web ? 'swing' : actor.glideOn ? 'glide' : actor.swim ? 'swim' : 'follow',
            transport: 'idle', web: actor.web, webHandMask, snareWebLines, pulseSegments, ringSegments, pulseProgress, snareColor: ownSnare ? GHOST_SNARE_COLOR : null, strandColor: lineMatRef.current?.color.getHexString(), shockColor: shockMatRef.current?.color.getHexString(), gripHands: animation.gripHands, snarePhase: animation.snarePhase, combo: actor.combo, kos: actor.kos,
        };
        if (DBG) (window as any).__ghostSim = actor;
    });

    return <>
        <primitive object={model.root} dispose={null} />
        <lineSegments ref={lineRef} geometry={lineGeo} frustumCulled={false} dispose={null}>
            <lineBasicMaterial ref={lineMatRef} color="#d8f5ff" transparent opacity={0.92} depthTest={false} depthWrite={false} />
        </lineSegments>
        <lineSegments ref={shockRef} geometry={shockGeo} frustumCulled={false} dispose={null}>
            <lineBasicMaterial ref={shockMatRef} color="#ffffff" transparent opacity={0.98} depthTest={false} depthWrite={false} />
        </lineSegments>
        <points ref={plasmaRef} geometry={plasmaGeo} frustumCulled={false} dispose={null}>
            <pointsMaterial map={SOFT_DOT} alphaTest={0.01} color="#c9f5ff" size={0.62} sizeAttenuation transparent opacity={0.95} depthWrite={false} />
        </points>
        <points ref={morphRef} geometry={morphGeo} visible={false} frustumCulled={false} dispose={null}>
            <pointsMaterial ref={morphMatRef} map={SOFT_DOT} alphaTest={0.01} color="#ffffff" vertexColors size={0.3} sizeAttenuation transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
        </points>
    </>;
}

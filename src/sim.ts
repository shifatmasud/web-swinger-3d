// Pure game simulation: city generation + swing physics. No rendering code here.
import { BOSS_BODY_OFFSET, BOSS_HIT_HALF_HEIGHT, BOSS_HIT_RADIUS } from './bossConfig';
import { SEA_BLDS, SEA_ANCHORS, BRIDGE, BRIDGE_L, bridgeDeckU, HARBOR, HBOSS, HBLOCKS, HBRIDGES, inHarbor, harborVoid, seaSurface, seaLift, poolAt, islandH, inCalmZone } from './seaWorld';
export type V3 = [number, number, number];
export interface Bld { x0: number; x1: number; z0: number; z1: number; h: number; host?: number; y0?: number; sea?: true; kind?: string }

export const CELL = 40, N = 15, HALF = (N * CELL) / 2;
export const FOG: V3 = [0.84, 0.77, 0.74];
const G = 60, G_FALL = 80, G_WEB = 27;   /* Oct 29 10:07 PM 'jump should be faster & faster to fall': snappier rise (27 -> 60) and a heavier fall (100 -> 80 at 10:37 PM 'fall a little bit slower'); 10:14 PM 'even faster'; web swings keep the old 27 */
export const WALK_V = 22;
export const JUMP_V = 24;   // was 16: same ~5 m height, reached in ~0.4 s (was ~0.6 s); whole jump ~0.7 s (was ~1.19 s)
export const PARK = { x0: 100, x1: 260, z0: 20, z1: 180 };
export const PARK_POND = { cx: 180, cz: 100, rx: 14, rz: 14 }; // circular lake (env-iter1)
// Valley topography remains unchanged outside the pond; the pond itself is a deeper bowl for swimming and underwater light.
function parkBaseH(x: number, z: number): number { const e = Math.min(x - PARK.x0, PARK.x1 - x, z - PARK.z0, PARK.z1 - z); if (e <= 0) return 0; const t = Math.min(1, e / 34), w = t * t * (3 - 2 * t); return w * (-5.0 + 1.4 * Math.sin(x * 0.06 + 1.0) * Math.cos(z * 0.05)); }
// env-iter1 lake profile: a real shelving shore. Water line at r=LAKE_SHORE (fraction of the radius), sandy bank rising above
// the water out to ~1.25r, then the valley takes over again. Keeps the old waterline height and the deep swimming bowl.
export const LAKE_SHORE = 0.93;
const sm = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const POND_BASE = parkBaseH(PARK_POND.cx, PARK_POND.cz);
function pondProfile(r: number) { return 0.55 - 3.25 * sm(LAKE_SHORE, LAKE_SHORE - 0.32, r) + 0.4 * sm(LAKE_SHORE - 0.02, LAKE_SHORE + 0.42, r); }
export function parkH(x: number, z: number): number {
    const base = parkBaseH(x, z), r = Math.hypot((x - PARK_POND.cx) / PARK_POND.rx, (z - PARK_POND.cz) / PARK_POND.rz);
    if (r > 2.3) return base;
    const f = 1 - sm(1.25, 2.3, r);
    return base * (1 - f) + (POND_BASE + pondProfile(r)) * f;
}
// Beach: a sand fringe all round the lake, widening into a proper beach on the side facing away from the trail (shared with the ground shader).
export const BEACH_DIR = Math.atan2(-0.514, 0.857);
export function sandWeight(x: number, z: number) {
    const dx = x - PARK_POND.cx, dz = z - PARK_POND.cz, d = Math.hypot(dx, dz);
    let da = Math.atan2(dz, dx) - BEACH_DIR; da = Math.atan2(Math.sin(da), Math.cos(da));
    const wide = sm(1.15, 0.0, Math.abs(da));
    const edge = PARK_POND.rx * LAKE_SHORE + 2.4 + 11.0 * wide + 0.9 * Math.sin(x * 0.37 + z * 0.21) + 0.6 * Math.sin(x * 0.83 - z * 0.67);
    return 1 - sm(edge - 1.6, edge + 0.6, d);
}
export function isLegacyCityCore(x: number, z: number) { return Math.abs(x) <= 120 && Math.abs(z) <= 120; }
// Keep the old waterline and bridge elevation; only the lake bed is lowered.
export const PARK_POND_Y = parkBaseH(PARK_POND.cx, PARK_POND.cz) + 0.55;
const bridgeYaw = -Math.atan2(0.857, 0.514); // follows the existing diagonal park trail
export const PARK_BRIDGE = {
    x: PARK_POND.cx, z: PARK_POND.cz, yaw: bridgeYaw,
    axisX: Math.cos(bridgeYaw), axisZ: -Math.sin(bridgeYaw),
    modules: 8, halfLength: 16, halfWidth: 1.35, rampLength: 5, // env-iter1: deck clears the round shore (r=14), ramps land on the trail
    deckY: PARK_POND_Y + 0.95,
};
export function bridgeSurfaceAt(x: number, z: number): number | null {
    const dx = x - PARK_BRIDGE.x, dz = z - PARK_BRIDGE.z;
    const along = dx * PARK_BRIDGE.axisX + dz * PARK_BRIDGE.axisZ;
    const across = -dx * PARK_BRIDGE.axisZ + dz * PARK_BRIDGE.axisX;
    if (Math.abs(across) > PARK_BRIDGE.halfWidth) return null;
    const end = Math.abs(along) - PARK_BRIDGE.halfLength;
    if (end <= 0) return PARK_BRIDGE.deckY;
    if (end > PARK_BRIDGE.rampLength) return null;
    const t = end / PARK_BRIDGE.rampLength;
    return PARK_BRIDGE.deckY * (1 - t) + parkH(x, z) * t;
}
export function isLakeWater(x: number, z: number) {
    if (z < WATER_Z && poolAt(x, z)) return true;   // South Sea 2: the island's lagoon + waterfall pool swim like the park lake
    const dx = (x - PARK_POND.cx) / PARK_POND.rx, dz = (z - PARK_POND.cz) / PARK_POND.rz;
    return dx * dx + dz * dz < LAKE_SHORE * LAKE_SHORE && bridgeSurfaceAt(x, z) === null;
}
export function lakeWaveH(x: number, z: number, t: number) { return Math.sin(x * 0.11 + z * 0.08 + t * 0.42) * 0.09 + Math.sin(x * 0.21 - z * 0.16 - t * 0.31) * 0.035; }
export function waterSurfaceAt(x: number, z: number, t = 0) { if (z < WATER_Z) { const pl = poolAt(x, z); if (pl) return pl.y + lakeWaveH(x, z, t); } return isLakeWater(x, z) ? PARK_POND_Y + lakeWaveH(x, z, t) : WATER_Y; }
/** floor of an inland water body (park lake or an island pool) */
export function lakeFloorAt(x: number, z: number) { return z < WATER_Z ? (islandH(x, z) ?? WATER_Y - 3) : parkH(x, z); }
export const WATER_Z = -222, WATER_Y = -1.0, SEABED = -10;
// Greater ocean (Shifat Oct 29, step 1 of the South Sea plan): playable sea far beyond the old city-edge wall, with a real depth profile:
// shallow shelf near the beach -> slope -> a deep trench -> rising again toward the future 2nd-city platform.
export const SEA = { zMin: -1290, xMax: HALF + 180 };   // South Sea 4: room for Neon Harbor (platform to z -1242) and the water around it
const _sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function seabedAt(x: number, z: number) {
    const d = WATER_Z - z;   // metres offshore
    let y = SEABED - 16 * _sm(110, 300, d) - 24 * _sm(420, 600, d) + 22 * _sm(760, 930, d);   // -10 shelf, -26 slope, -50 trench, -28 far shelf
    y += Math.sin(x * 0.045 + z * 0.021) * 1.4 * _sm(30, 120, d) + Math.sin(x * 0.013 - z * 0.032) * 2.2 * _sm(200, 400, d);   // dunes / ridges
    return seaLift(x, z, Math.min(y, SEABED));   // South Sea 2: the island rises out of the seabed
}

let seedv = 1337;
const rnd = () => { seedv = (seedv * 1664525 + 1013904223) % 4294967296; return seedv / 4294967296; };

const FACES: [V3, V3, V3, V3, V3][] = [
    [[0, 0, 1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
    [[0, 0, -1], [1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
    [[1, 0, 0], [1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]],
    [[-1, 0, 0], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
    [[0, 1, 0], [-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]],
    [[0, -1, 0], [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],
];

function buildWorld() {
    const blds: Bld[] = [];
    const streetBlds: Bld[] = [];
    const data: number[] = [];
    const idx: number[] = [];
    let hideProceduralBuildingVisuals = false;
    const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, col: V3, seed: number, skipBottom = true) => {
        for (let fi = 0; fi < 6; fi++) {
            if (skipBottom && fi === 5) continue;
            const f = FACES[fi], base = data.length / 10, n = f[0];
            for (let i = 1; i < 5; i++) { const p = f[i]; data.push(cx + p[0] * sx, cy + p[1] * sy, cz + p[2] * sz, n[0], n[1], n[2], col[0], col[1], col[2], hideProceduralBuildingVisuals ? 100 : seed); }
            idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
    };
    const mi = (N - 1) / 2;
    for (let i = 0; i < N; i++) for (let j = 2; j < N; j++) {
        const cx = (i - mi) * CELL, cz = (j - mi) * CELL;
        if (cx > PARK.x0 && cx < PARK.x1 && cz > PARK.z0 && cz < PARK.z1) continue; // forest park block
        hideProceduralBuildingVisuals = !isLegacyCityCore(cx, cz);
        const blockStart=[data.length,idx.length,blds.length];
        const dc = Math.hypot(cx, cz) / HALF;
        const w = 20 + rnd() * 8, d = 20 + rnd() * 8;
        let h = 28 + rnd() * 50 + (1 - dc) * 40 * rnd();
        if (rnd() < 0.12) h = 18 + rnd() * 10;
        if (rnd() < 0.08) h += 40;
        if (i === mi && j === mi) h = 30;
        else if (Math.abs(i - mi) <= 1 && Math.abs(j - mi) <= 1) h = 40 + rnd() * 15;
        blds.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, h });
        const tint = rnd();
        const pal: V3[] = [[0.93, 0.76, 0.64], [0.62, 0.77, 0.68], [0.6, 0.76, 0.92], [0.96, 0.86, 0.6], [0.74, 0.68, 0.9]];
        const col: V3 = pal[Math.floor(((i * 7 + j * 3) % 5 + tint * 1.5) % 5)];
        // stepped tower: base + slimmer top section for silhouette variety
        if (h > 40 && rnd() < 0.75) {
            const hb = h * 0.72;
            box(cx, hb / 2, cz, w / 2, hb / 2, d / 2, col, rnd());
            box(cx, hb + (h - hb) / 2, cz, w / 2 - 3, (h - hb) / 2, d / 2 - 3, col, rnd());
            // ledge so the upper section is not a hover: (collision uses the full box, fine)
            box(cx, hb + 0.4, cz, w / 2 + 0.6, 0.4, d / 2 + 0.6, [0.3, 0.28, 0.4], 0.5);
        } else box(cx, h / 2, cz, w / 2, h / 2, d / 2, col, rnd());
        const neon: V3[] = [[0.95, 0.6, 0.74], [0.55, 0.85, 0.95], [1.0, 0.78, 0.5], [0.72, 0.62, 0.95]];   // softened sign colours (calm palette)
        if (h > 34 && rnd() < 0.55) {
            const nc = neon[Math.floor(rnd() * 4)], py = h * (0.35 + rnd() * 0.3);
            if (rnd() < 0.5) { box(cx + (rnd() - 0.5) * (w - 12), py, cz - d / 2 - 0.3, 5 + rnd() * 3, 2.5 + rnd() * 2, 0.3, nc, 1.15); }
            else { box(cx + w / 2 + 0.3, py, cz + (rnd() - 0.5) * (d - 12), 0.3, 2.5 + rnd() * 2, 5 + rnd() * 3, nc, 1.15); }
        }
        if (rnd() < 0.4) { const nc = neon[Math.floor(rnd() * 4)]; box(cx, h + 0.15, cz, w / 2 + 0.2, 0.15, 0.2, nc, 1.15); }
        // skyline variety: crown tiers and spires on tall towers, window-band trim ledges
        if (h > 62) {
            // crown block in a roof corner, away from the landing/beacon centre; also a real collision box so it is solid and landable
            const ch = 8 + rnd() * 4, hx = 3, hz = 3, ccx = cx - w * 0.34, ccz = cz - d * 0.34;
            box(ccx, h + ch / 2, ccz, hx, ch / 2, hz, col, rnd());
            box(ccx, h + ch + 0.3, ccz, hx + 0.4, 0.3, hz + 0.4, [0.3, 0.28, 0.4], 0.5);
            blds.push({ x0: ccx - hx - 0.4, x1: ccx + hx + 0.4, z0: ccz - hz - 0.4, z1: ccz + hz + 0.4, h: h + ch + 0.6, host: blds.length - 1 }); // collision covers the ledge lip
        }
        for (let ly = 14; ly < h - 2; ly += 14) box(cx, ly, cz, w / 2 + 0.35, 0.3, d / 2 + 0.35, [0.3, 0.27, 0.36], 0.5);
        box(cx + w * 0.3, h + 3.2, cz + d * 0.3, 0.25, 0.25, 0.25, [1, 0.15, 0.1], 2.0);
        // water tank on legs + AC units + antenna mast (rooftop variety)
        if (rnd() < 0.5) { const tx = cx + (rnd() - 0.5) * (w - 8), tz2 = cz + (rnd() - 0.5) * (d - 8); box(tx, h + 2, tz2, 0.3, 2, 0.3, [0.3, 0.25, 0.25], 0.5); box(tx, h + 5, tz2, 2.1, 2.2, 2.1, [0.72, 0.45, 0.38], 0.5); box(tx, h + 7.4, tz2, 1.6, 0.3, 1.6, [0.4, 0.3, 0.3], 0.5); }
        for (let k = 0; k < 3; k++) if (rnd() < 0.6) box(cx + (rnd() - 0.5) * (w - 6), h + 0.8, cz + (rnd() - 0.5) * (d - 6), 1.2 + rnd(), 0.8, 1 + rnd(), [0.82, 0.84, 0.88], 0.5);
        if (rnd() < 0.5) { const ax = cx + (rnd() - 0.5) * w * 0.6; box(ax, h + 6, cz, 0.12, 6, 0.12, [0.3, 0.3, 0.35], 0.5); box(ax, h + 9, cz, 1.4, 0.1, 0.1, [0.3, 0.3, 0.35], 0.5); }
        const roofCol: V3 = [0.25, 0.25, 0.32];
        box(cx - w * 0.2, h + 0.7, cz + d * 0.15, 2.2, 0.7, 2.2, roofCol, 0.5);
        if (rnd() < 0.5) { box(cx + w * 0.25, h + 1.5, cz - d * 0.2, 0.4, 1.5, 0.4, [0.7, 0.2, 0.25], 0.5); }
        if (rnd() < 0.3) box(cx + w * 0.1, h + 0.25, cz - d * 0.1, w * 0.3, 0.25, d * 0.12, [0.9, 0.55, 0.3], 0.5); // roof glow strip
        // One six-home Polyfork block replaces an existing outer-city tower, preserving RNG for every other block.
        hideProceduralBuildingVisuals = false;
        streetBlds.push(...blds.slice(blockStart[2]).filter(b=>b.host===undefined));
        if(cx===-240 && cz===80){data.length=blockStart[0];idx.length=blockStart[1];blds.length=blockStart[2];for(let k=0;k<6;k++){const x=-249+(k%3)*9,z=72+Math.floor(k/3)*17;const host=blds.length;blds.push({x0:x-4,x1:x+4,z0:z-4,z1:z+4,h:18});
            for(const q of [[-4,-3.7,-4,4], [3.7,4,-4,4], [-3.7,3.7,-4,-3.7],[-3.7,3.7,3.65,4]]) blds.push({x0:x+q[0],x1:x+q[1],z0:z+q[2],z1:z+q[3],h:19,host});
            // Measured rooftop hatch bound, conservative enclosing height for small rooftop fittings.
            const rot=k>=3?-1:1;blds.push({x0:x+(rot>0?-2.08:.52),x1:x+(rot>0?-.52:2.08),z0:z+(rot>0?-1.57:.37),z1:z+(rot>0?-.37:1.57),h:18.8,host});
            blds.push({x0:x+(rot>0?2.16:-2.44),x1:x+(rot>0?2.44:-2.16),z0:z+(rot>0?-2.04:1.76),z1:z+(rot>0?-1.76:2.04),h:18.62,host});}}
    }
    const g = HALF + 200, base = data.length / 10;
    for (const p of [[-g, g], [g, g], [g, WATER_Z], [-g, WATER_Z]]) data.push(p[0], 0, p[1], 0, 1, 0, 0.16, 0.15, 0.2, 0.5);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return { blds, streetBlds, data: new Float32Array(data), idx: new Uint32Array(idx) };
}
export const world = buildWorld();
const blds = world.blds;
for (const b of SEA_BLDS) blds.push(b);   // South Sea: lighthouse, shacks (and later bridge towers, harbor towers) collide and take webs like buildings

// Fixed rooftop arena on the central tower, distinct from the player's spawn roof.
const arenaRoof = blds.find((b) => b.host === undefined && Math.abs((b.x0 + b.x1) / 2 - 40) < 1 && Math.abs((b.z0 + b.z1) / 2) < 1);
if (!arenaRoof) throw new Error('Boss arena rooftop was not generated');
export const BOSS_ARENA = {
    x: (arenaRoof.x0 + arenaRoof.x1) / 2,
    y: arenaRoof.h + 1,
    z: (arenaRoof.z0 + arenaRoof.z1) / 2,
    roof: { x0: arenaRoof.x0, x1: arenaRoof.x1, z0: arenaRoof.z0, z1: arenaRoof.z1 },
};

export type BossFlightPhase = 'grounded' | 'takeoff' | 'hover' | 'propel' | 'landing';
export interface BossFlightState { phase: BossFlightPhase; phaseT: number; baseY: number; startX: number; startZ: number; targetX: number; targetZ: number; cycle: number }
const BOSS_FLIGHT = { groundWait: 3.2, takeoff: 0.95, hover: 1.15, propel: 1.8, landing: 0.9, altitude: 6.5, forward: 8.5, lateral: 4.5 };
export interface Enemy { roof?: { x0: number; x1: number; z0: number; z1: number }; x: number; y: number; z: number; hp: number; atk: number; hit: number; kb: [number, number]; ang: number; down: number; kind?: number; air?: boolean; born?: number; boss?: boolean; flight?: BossFlightState }
export interface Sim {
    mode: 'menu' | 'play' | 'over';
    pos: V3; vel: V3; ground: boolean; web: boolean; anchor: V3; rope: number;
    camHeld?: boolean; yaw: number; pitch: number; ang: number; score: number; time: number; best: number;
    hp: number; hurtT: number; atkT: number; dodgeT: number; combo: number; comboT: number; kos: number; land: number; landHard: number; enemies: Enemy[]; lastHit: number;
    orbs: V3[]; beacon: V3; beaconN: number; t: number; runPhase: number; lastDrag: number; safe: V3; maxSpeed: number; swings: number; webT: number; atkPend: number; shotE: Enemy | null; anchorReal: boolean; spring: number; shotT: number; shotTgt: V3; glideOn: boolean; airT: number;
    grappleFlight?: boolean; webDepartB?: number; swim: boolean; dive: boolean; wall: [number, number] | null; wallB: number; wallT: number; vaulted: number;
    plasma: Plasma[]; blasts: Blast[]; aimE: Enemy | null;
    eshots?: EShot[];
}
// plasma web shot: a visible bolt (plasma core wrapped in web strands) with gentle homing; blasts drive the shockwave VFX
export interface Plasma { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; tgt: Enemy | null }
export interface Blast { x: number; y: number; z: number; t: number; r: number }
// env-iter3 F (Shifat Oct 29: "Let enemies & bosses fire shots like Iron Man"): repulsor bolts from an open palm (regular enemies:
// 0.4 s palm-glow telegraph, then a fast bolt at the hero's predicted position, 2-3 s cooldown; bosses: 3-shot volleys) and the
// boss chest unibeam (1 s visible charge, then a 1.5 s beam that sweeps after the hero slower than he can swing). Hits go through
// the existing hurt path (hp, hurtT, lastHit, ev.hurt) and respect dodge i-frames; Web Shock pops bolts around the hero.
export interface EShot { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; boss: boolean; dead: number }
export const ESHOT = { SPEED: 30, BOSS_SPEED: 36, CHARGE: 0.4, DMG: 8, BOSS_DMG: 10, HIT_R: 0.95, LIFE: 2.2, MAX: 24, MIN_GAP: 0.35, RANGE_MIN: 6, RANGE: 30,
    UNI_CHARGE: 1.0, UNI_FIRE: 1.5, UNI_LEN: 48, UNI_R: 1.1, UNI_DMG: 9, UNI_TURN: 0.75, UNI_CD: 9 };
export interface Unibeam { phase: 'charge' | 'fire'; t: number; yaw: number; pitch: number; ox: number; oy: number; oz: number; tick: number }
export interface Input { jumpHeld?: boolean; jumpReleased?: boolean; jumpCancelled?: boolean; attackQ: boolean; dodgeQ: boolean; mx: number; my: number; swing: boolean; keys: Record<string, boolean>; jumpQ: boolean; swingQ: boolean; glide?: boolean; grabQ?: boolean; shotQ?: boolean; meleeQ?: boolean; specialQ?: boolean; rideQ?: boolean }
export interface Events { orb: () => void; fall: () => void; attach: () => void; release: () => void; jump: () => void; hit: () => void; hurt: () => void; ko: () => void; land: (hard: boolean) => void; blast?: (x: number, y: number, z: number) => void; shot?: (kind: 'charge' | 'bolt' | 'impact' | 'uniCharge' | 'uniStart' | 'uniMove' | 'uniStop', x: number, y: number, z: number) => void }

export const input: Input = { rideQ: false, attackQ: false, dodgeQ: false, mx: 0, my: 0, swing: false, keys: {}, jumpQ: false, swingQ: false, glide: false };
(globalThis as any).__svMainInput = input;
let companionSim: Sim | null = null;
export function setCompanionSim(s: Sim | null) { companionSim = s; }

export function createSim(): Sim {
    let best = 0;
    try { best = parseInt(localStorage.getItem('webswinger3d-best') || '0', 10) || 0; } catch (e) { /* ignore */ }
    const s: Sim = { mode: 'menu', pos: [0, 0, 0], vel: [0, 0, 0], ground: true, web: false, atkPend: 0, shotE: null, anchorReal: false, spring: 0, shotT: 0, shotTgt: [0, 0, 0], glideOn: false, airT: 0, anchor: [0, 0, 0], rope: 20, yaw: 0, pitch: 0.28, ang: 0, score: 0, time: 75, best, hp: 100, hurtT: 0, atkT: 0, dodgeT: 0, combo: 0, comboT: 0, kos: 0, land: 0, landHard: 0, enemies: [], lastHit: -9, orbs: [], beacon: [0, 0, 0], beaconN: 0, t: 0, runPhase: 0, lastDrag: -10, safe: [0, 0, 0], maxSpeed: 0, swings: 0, webT: 0, swim: false, dive: false, wall: null, wallB: -1, wallT: 0, vaulted: 0, plasma: [], blasts: [], aimE: null };
    resetSim(s);
    return s;
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function newOrb(s: Sim): V3 {
    // orbs spawn 30-120 m from the player, at swingable heights, over streets or roofs
    for (let k = 0; k < 40; k++) {
        const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 90;
        const x = Math.max(-HALF + 10, Math.min(HALF - 10, s.pos[0] + Math.sin(a) * r)), z = Math.max(-HALF + 10, Math.min(HALF - 10, s.pos[2] + Math.cos(a) * r));
        const y = 28 + Math.random() * 40;
        let inside = false;
        for (const b of blds) if (x > b.x0 - 2 && x < b.x1 + 2 && z > b.z0 - 2 && z < b.z1 + 2 && y < b.h + 3) { inside = true; break; }
        if (!inside) return [x, y, z];
    }
    return [s.pos[0] + 40, 50, s.pos[2]];
}
function newBeacon(s: Sim): V3 {
    // beacon sits on the roof of a building 70-170 m away
    const cand = blds.filter((b) => { const d = Math.hypot((b.x0 + b.x1) / 2 - s.pos[0], (b.z0 + b.z1) / 2 - s.pos[2]); return b.x1 - b.x0 > 10 && d > 70 && d < 170; });
    const b = cand.length ? cand[Math.floor(Math.random() * cand.length)] : blds[Math.floor(Math.random() * blds.length)];
    return [(b.x0 + b.x1) / 2, b.h + 1.5, (b.z0 + b.z1) / 2];
}
function inPk(x: number, z: number) { return x > PARK.x0 && x < PARK.x1 && z > PARK.z0 && z < PARK.z1; }   // street enemies stay out of the sunken park
export const ENEMY_N = 26;   // was 10: user wants many enemies always in view (iteration choice, not a user number)
function spawnEnemy(s: Sim): Enemy {
    const kind = [0, 0, 1, 2, 2, 3][Math.floor(Math.random() * 6)];   // kind 2 = flying quad drone, kind 3 = Shadow-body heavy robot (the dome is retired)
    const e = spawnEnemy0(s, kind === 2); e.kind = kind; e.born = s.t;
    if (kind === 2) { e.air = true; e.roof = undefined; e.y = (inHarbor(e.x, e.z, 10) ? HARBOR.y : 0) + 6 + Math.random() * 26; }   // hover drones patrol the street canyons at altitude
    return e;
}
const PARKED = (): Enemy => ({ x: 20, y: 1, z: 20, hp: 3, atk: 0, hit: 0, kb: [0, 0], ang: 0, down: 0 });
export const HARBOR_ENEMY_CAP = 9;   // Neon Harbor: "a few enemies" at a time around the hero; the rest wait parked in the city
function spawnHarbor(s: Sim, noRoof: boolean): Enemy {
    let n = 0; for (const q of s.enemies) if (!q.boss && q.down <= 0 && inHarbor(q.x, q.z, 30)) n++;
    if (n >= HARBOR_ENEMY_CAP) return PARKED();
    const hp = s.pos;
    if (!noRoof && Math.random() < 0.4) {
        const cand = blds.filter((b) => b.kind === 'harbor' && b.x1 - b.x0 > 10 && b.h - HARBOR.y < 70 && Math.hypot((b.x0 + b.x1) / 2 - hp[0], (b.z0 + b.z1) / 2 - hp[2]) > 25 && Math.hypot((b.x0 + b.x1) / 2 - hp[0], (b.z0 + b.z1) / 2 - hp[2]) < 140 && Math.abs((b.x0 + b.x1) / 2 - HBOSS.x) + Math.abs((b.z0 + b.z1) / 2 - HBOSS.z) > 1);
        if (cand.length) { const b = cand[Math.floor(Math.random() * cand.length)]; return { roof: { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 }, x: (b.x0 + b.x1) / 2 + (Math.random() - 0.5) * 6, y: b.h + 1, z: (b.z0 + b.z1) / 2 + (Math.random() - 0.5) * 6, hp: 3, atk: 0, hit: 0, kb: [0, 0], ang: 0, down: 0 }; }
    }
    for (let k = 0; k < 40; k++) {
        const x = hp[0] + (Math.random() - 0.5) * 180, z = hp[2] + (Math.random() - 0.5) * 180;
        if (!inHarbor(x, z) || harborVoid(x, z) || Math.hypot(x - hp[0], z - hp[2]) < 18 || Math.hypot(x - hp[0], z - hp[2]) > 95) continue;
        let inside = false; for (const b of blds) if (b.sea && x > b.x0 - 1 && x < b.x1 + 1 && z > b.z0 - 1 && z < b.z1 + 1) { inside = true; break; }
        if (!inside) return { x, y: HARBOR.y + 1, z, hp: 3, atk: 0, hit: 0, kb: [0, 0], ang: 0, down: 0 };
    }
    return PARKED();
}
function spawnEnemy0(s: Sim, noRoof = false): Enemy {
    if (inHarbor(s.pos[0], s.pos[2], 40)) return spawnHarbor(s, noRoof);   // South Sea 4: Neon Harbor's own street / roof bots
    if (s.pos[2] < WATER_Z - 30) return PARKED();   // open sea, the bridge and the island are calm: nothing spawns out there
    if (!noRoof && Math.random() < 0.4) {
        const cand = blds.filter((b) => { const d = Math.hypot((b.x0 + b.x1) / 2 - s.pos[0], (b.z0 + b.z1) / 2 - s.pos[2]); return b.x1 - b.x0 > 10 && d > 30 && d < 150 && b.h < 60 && (!b.sea || b.kind === 'harbor') && !inCalmZone((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2); });
        if (cand.length) { const b = cand[Math.floor(Math.random() * cand.length)]; return { roof: { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 }, x: (b.x0 + b.x1) / 2 + (Math.random() - 0.5) * 6, y: b.h + 1, z: (b.z0 + b.z1) / 2 + (Math.random() - 0.5) * 6, hp: 3, atk: 0, hit: 0, kb: [0, 0], ang: 0, down: 0 }; }
    }
    for (let k = 0; k < 60; k++) {
        let x = (Math.floor(Math.random() * (N - 1)) - (N - 2) / 2) * CELL + (Math.random() < 0.5 ? -CELL / 2 + 0 : CELL / 2 - 0), z = (Math.random() - 0.5) * 2 * (HALF - 40);
        if (Math.random() < 0.8) { x = s.pos[0] + (Math.random() - 0.5) * 200; z = s.pos[2] + (Math.random() - 0.5) * 200; if (Math.hypot(x - s.pos[0], z - s.pos[2]) > 100) continue; }   // most spawns land within ~100 m of the hero so the street stays populated
        if (z < WATER_Z + 8) continue;
        if (x > PARK.x0 - 4 && x < PARK.x1 + 4 && z > PARK.z0 - 4 && z < PARK.z1 + 4) continue;   // the park is a sunken bowl: no street-level spawns there
        const sx = Math.round((x - CELL / 2) / CELL) * CELL + CELL / 2;
        if (Math.hypot(sx - s.pos[0], z - s.pos[2]) < 18) continue;
        let inside = false;
        for (const b of blds) if (sx > b.x0 - 1 && sx < b.x1 + 1 && z > b.z0 - 1 && z < b.z1 + 1) { inside = true; break; }
        if (!inside) return { x: sx, y: 1, z, hp: 3, atk: 0, hit: 0, kb: [0, 0], ang: 0, down: 0 };
    }
    return { x: 20, y: 1, z: 20, hp: 3, atk: 0, hit: 0, kb: [0, 0], ang: 0, down: 0 };
}
function spawnBoss(s: Sim): Enemy {
    const e = spawnEnemy0(s, true);
    e.x = BOSS_ARENA.x; e.y = BOSS_ARENA.y; e.z = BOSS_ARENA.z; e.roof = { ...BOSS_ARENA.roof };
    e.boss = true; e.kind = 0; e.hp = 24; e.atk = 0; e.hit = 0; e.kb = [0, 0]; e.ang = 0; e.down = 0; e.born = s.t;
    e.flight = { phase: 'grounded', phaseT: 0, baseY: e.y, startX: e.x, startZ: e.z, targetX: e.x, targetZ: e.z, cycle: 0 };
    return e;
}
// South Sea 4: Neon Harbor's mini-boss on the tallest tower. Same boss code path (zone aggro, 90 m give-up, hover-dash chase, volleys,
// chest beam), with its own arena and a smaller body / fewer HP. It stays inside the harbor.
function spawnMiniBoss(s: Sim): Enemy {
    const e = spawnBoss(s) as any;
    e.x = HBOSS.x; e.y = HBOSS.y; e.z = HBOSS.z; e.roof = { ...HBOSS.roof }; e.hp = 14; e.mini = true; e.arena = HBOSS;
    e.flight = { phase: 'grounded', phaseT: 0, baseY: e.y, startX: e.x, startZ: e.z, targetX: e.x, targetZ: e.z, cycle: 0 };
    return e;
}
export function resetSim(s: Sim) {
    const b = blds.reduce((best, c) => Math.hypot(c.x0, c.z0) < Math.hypot(best.x0, best.z0) ? c : best, blds[0]);
    s.pos = [(b.x0 + b.x1) / 2 + 4, b.h + 1, (b.z0 + b.z1) / 2 - 4]; s.vel = [0, 0, 0]; s.web = false; s.ground = true; s.safe = [...s.pos] as V3;
    s.camHeld = false; s.score = 0; s.time = 0; s.yaw = 0; s.swings = 0; s.maxSpeed = 0; s.ang = 0;
    s.orbs = []; for (let i = 0; i < 18; i++) s.orbs.push(newOrb(s));
    s.beaconN = 0; s.beacon = newBeacon(s);
    s.glideOn = false; s.airT = 0; (s as any).pressT = undefined; (s as any).flightBoost = false; (s as any).glideMode = false; (s as any).dblUsed = false;
    input.jumpQ = false; input.jumpHeld = false; input.jumpReleased = false; input.jumpCancelled = false; input.keys[' '] = false;
    s.grappleFlight = false; (s as any).glideBlocked = false; s.webDepartB = undefined; s.wall = null; s.swim = false; s.dive = false; s.wallT = 0; s.vaulted = 0; s.hp = 100; s.hurtT = 0; s.atkT = 0; s.dodgeT = 0; s.combo = 0; s.comboT = 0; s.kos = 0; s.land = 0; s.landHard = 0;
    s.plasma = []; s.blasts = []; s.eshots = []; s.aimE = null; s.shotE = null; const sa = s as any; sa.snareCd = 0; sa.snareT = 0; sa.snareList = [];
    s.enemies = []; for (let i = 0; i < ENEMY_N; i++) s.enemies.push(spawnEnemy(s)); s.enemies.push(spawnBoss(s)); s.enemies.push(spawnMiniBoss(s));
}


// Flying cars (Shifat Oct 29: "flying cars must have collision & web must work on them"). One deterministic traffic model shared by
// the renderer and the sim: cars run along street lanes at fixed altitudes; the hero collides with them (stands on the roof and rides
// along, bumps off the sides and underside) and web swings / spring shots can attach under a car and ride with it.
export const CITY_CAR_N = 36, BRIDGE_CAR_N = 14, CAR_N = CITY_CAR_N + BRIDGE_CAR_N, CAR_SCALE = 2.4;   // South Sea 3b: 14 more flying cars hover along the long bridge
/** Nearest street ped to the hero, published by the renderer each frame (for ped voice lines). */
export const PED_VOICE = { x: 0, y: 0, z: 0, d: 1e9, t: 0 };
export const CARS = [...Array.from({ length: CITY_CAR_N }, (_, i) => ({ axis: i % 2, lane: ((i * 7) % 15) - 7, y: 34 + (i * 13) % 40, sp: (12 + (i * 5) % 14) * (i % 4 < 2 ? 1 : -1), off: (i * 97) % 600 })), ...Array.from({ length: BRIDGE_CAR_N }, (_, i) => ({ axis: 2, lane: i % 3, y: i % 2 ? 5 + (i % 3) * 1.5 : 10 + (i * 7) % 6, sp: 13 + (i * 5) % 9, off: (i * 211) % 1500 }))];   // bridge cars: off spreads them over the ~2.9 km loop
const CAR_HX = 1.0 * CAR_SCALE, CAR_HZ = 2.2 * CAR_SCALE, CAR_BOT = -0.5 * CAR_SCALE, CAR_TOP = 1.01 * CAR_SCALE;
/** World position, velocity and half extents of car i at sim time t. */
/** The car the player is flying (Shifat Oct 29: "let us ride flying cars", "Enter when close to vehicle to ride"). i = -1: none.
 *  parked: the hero hopped out; the car hovers where it was left until another car is taken. */
export const PILOT = { i: -1, x: 0, y: 0, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0, parked: false, turn: 0 };   // i >= 100: boat (i - 100)
export const RIDE_RANGE = 9;
export function carAt(i: number, t: number) {
    if (PILOT.i === i) { const hx = Math.abs(Math.sin(PILOT.yaw)) > 0.7 ? CAR_HZ : CAR_HX, hz = hx === CAR_HZ ? CAR_HX : CAR_HZ; return { x: PILOT.x, y: PILOT.y, z: PILOT.z, vx: PILOT.vx, vy: PILOT.vy, vz: PILOT.vz, hx, hz, wrap: false, yaw: PILOT.yaw }; }
    const c = CARS[i];
    if (c.axis === 2) {   // bridge traffic (2c, Shifat 5:49 PM "cars must move to each city instead of popping"): one continuous loop with no pops:
        // south down the x=140 city street (descending from city-traffic height), along the bridge, onto Neon Harbor's avenue, a U-turn among
        // the towers, back north the same way on the west lanes, and a U-turn at the city's north edge.
        const wMin = -(HALF - 4) + BRIDGE.z0, wMax = BRIDGE_L + 128, S = wMax - wMin, RT = 6, P = 2 * S + 2 * Math.PI * RT, lane = 2.2 + c.lane * 0.8;
        const q = ((c.off * 2 + t * c.sp) % P + P) % P;
        const baseY = (w: number) => w < 0 ? 0.05 + 12 * sm(-25, -170, w) : w > BRIDGE_L ? HARBOR.y : bridgeDeckU(w);
        const latAt = (w: number) => lane + (RT - lane) * (sm(wMax - 30, wMax, w) + sm(wMin + 30, wMin, w));
        let x: number, w: number, yaw: number, vx: number, vz: number;
        if (q < S) { w = wMin + q; x = BRIDGE.x + latAt(w); yaw = Math.PI; vx = 0; vz = -c.sp; }
        else if (q < S + Math.PI * RT) { const th = (q - S) / RT; x = BRIDGE.x + RT * Math.cos(th); w = wMax + RT * Math.sin(th); vx = -Math.sin(th) * c.sp; vz = -Math.cos(th) * c.sp; yaw = Math.atan2(vx, vz); }
        else if (q < 2 * S + Math.PI * RT) { w = wMax - (q - S - Math.PI * RT); x = BRIDGE.x - latAt(w); yaw = 0; vx = 0; vz = c.sp; }
        else { const th = Math.PI + (q - 2 * S - Math.PI * RT) / RT; x = BRIDGE.x + RT * Math.cos(th); w = wMin + RT * Math.sin(th); vx = -Math.sin(th) * c.sp; vz = -Math.cos(th) * c.sp; yaw = Math.atan2(vx, vz); }
        const turning = Math.abs(vx) > 0.3 * c.sp;
        return { x, y: baseY(w) + c.y + Math.sin(t * 1.1 + i) * 0.5, z: BRIDGE.z0 - w, vx, vy: Math.cos(t * 1.1 + i) * 0.55, vz, hx: turning ? CAR_HZ : CAR_HX, hz: CAR_HZ, wrap: false, yaw };
    }
    const u = ((c.off + t * c.sp) % 640 + 640) % 640 - 320, l = c.lane * CELL + CELL / 2, y = c.y + Math.sin(t + i) * 0.6, vy = Math.cos(t + i) * 0.6;
    return c.axis === 0 ? { x: l, y, z: u, vx: 0, vy, vz: c.sp, hx: CAR_HX, hz: CAR_HZ, wrap: Math.abs(u) > 316, yaw: c.sp > 0 ? 0 : Math.PI } : { x: u, y, z: l, vx: c.sp, vy, vz: 0, hx: CAR_HZ, hz: CAR_HX, wrap: Math.abs(u) > 316, yaw: c.sp > 0 ? Math.PI / 2 : -Math.PI / 2 };
}
function collideCars(s: Sim, prevY: number, dt: number) {
    const p = s.pos, v = s.vel, hw = 0.5, hh = 1.0;
    for (let i = 0; i < CAR_N; i++) {
        if (PILOT.i === i && !PILOT.parked) continue;   // the car you are flying
        const c = carAt(i, s.t); if (c.wrap) continue;
        const top = c.y + CAR_TOP, bot = c.y + CAR_BOT;
        if (p[0] + hw <= c.x - c.hx || p[0] - hw >= c.x + c.hx || p[2] + hw <= c.z - c.hz || p[2] - hw >= c.z + c.hz || p[1] - hh > top + 0.05 || p[1] + hh <= bot) continue;
        if (prevY - hh >= top - 0.8 && v[1] <= 0.5 + c.vy) {   // land on the roof and ride along
            p[1] = top + hh; if (v[1] < c.vy) v[1] = c.vy; s.ground = true; p[0] += c.vx * dt; p[2] += c.vz * dt; (s as any).onCar = i; continue;
        }
        if (prevY + hh <= bot + 0.5 && v[1] > 0) { p[1] = bot - hh; v[1] = Math.min(v[1], 0); continue; }   // bonk the underside
        const l = p[0] + hw - (c.x - c.hx), r = (c.x + c.hx) - (p[0] - hw), f = p[2] + hw - (c.z - c.hz), k = (c.z + c.hz) - (p[2] - hw), m = Math.min(l, r, f, k);
        if (m === l) { p[0] -= l; v[0] = Math.min(v[0], c.vx) - 2; } else if (m === r) { p[0] += r; v[0] = Math.max(v[0], c.vx) + 2; }
        else if (m === f) { p[2] -= f; v[2] = Math.min(v[2], c.vz) - 2; } else { p[2] += k; v[2] = Math.max(v[2], c.vz) + 2; }   // shoved by the car
    }
}

// Drifting boats (South Sea step 1b): slow loops offshore; solid (stand on the deck and ride, bump the hull) and their mast top is a web anchor.
export const BOATS = [
    { cx: -120, cz: -330, r: 55, w: 0.045, ph: 0.0, kind: 0 }, { cx: 140, cz: -380, r: 70, w: -0.035, ph: 2.0, kind: 1 },
    { cx: -40, cz: -520, r: 90, w: 0.028, ph: 4.1, kind: 0 }, { cx: 262, cz: -600, r: 72, w: -0.03, ph: 1.2, kind: 1 },   // South Sea: kept east of the bridge piers
    { cx: -330, cz: -640, r: 90, w: 0.022, ph: 3.3, kind: 0 },   // South Sea: kept clear of the island { cx: 60, cz: -880, r: 120, w: -0.02, ph: 5.0, kind: 1 },
];
export const BOAT_HX = 2.3, BOAT_HZ = 6.2, BOAT_DECK = 1.5, BOAT_MAST = 11;
export function boatAt(i: number, t: number) {
    if (PILOT.i === 100 + i) return { x: PILOT.x, z: PILOT.z, y: WATER_Y + Math.sin(t * 0.9 + i * 1.7) * 0.25, vx: PILOT.vx, vz: PILOT.vz, yaw: PILOT.yaw, roll: Math.sin(t * 0.7 + i) * 0.05 - Math.max(-0.12, Math.min(0.12, PILOT.turn * 0.12)) };
    const b = BOATS[i], a = b.ph + t * b.w, x = b.cx + Math.cos(a) * b.r, z = b.cz + Math.sin(a) * b.r;
    const sp = b.w * b.r, vx = -Math.sin(a) * sp, vz = Math.cos(a) * sp, yaw = Math.atan2(vx, vz);
    return { x, z, y: WATER_Y + Math.sin(t * 0.9 + i * 1.7) * 0.25, vx, vz, yaw, roll: Math.sin(t * 0.7 + i) * 0.05 };
}
function collideBoats(s: Sim, prevY: number, dt: number) {
    const p = s.pos, v = s.vel, hw = 0.5, hh = 1.0;
    for (let i = 0; i < BOATS.length; i++) {
        if (PILOT.i === 100 + i && !PILOT.parked) continue;
        const b = boatAt(i, s.t), dx = p[0] - b.x, dz = p[2] - b.z; if (dx * dx + dz * dz > 100) continue;
        const cs = Math.cos(b.yaw), sn = Math.sin(b.yaw), lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;   // into the boat frame (+z = bow)
        const top = b.y + BOAT_DECK, bot = b.y - 1.4, taper = 1 - 0.55 * Math.max(0, lz / BOAT_HZ);   // pointed bow
        if (Math.abs(lx) >= BOAT_HX * taper + hw || Math.abs(lz) >= BOAT_HZ + hw || p[1] - hh > top + 0.05 || p[1] + hh <= bot) continue;
        if (prevY - hh >= top - 0.8 && v[1] <= 0.5) { p[1] = top + hh; if (v[1] < 0) v[1] = 0; s.ground = true; s.swim = false; p[0] += b.vx * dt; p[2] += b.vz * dt; (s as any).onBoat = i; continue; }
        // push out sideways (or off the bow/stern), in the boat frame, then back to world
        const ox = (BOAT_HX * taper + hw) - Math.abs(lx), oz = (BOAT_HZ + hw) - Math.abs(lz);
        let nlx = lx, nlz = lz; if (ox < oz) nlx = Math.sign(lx || 1) * (BOAT_HX * taper + hw); else nlz = Math.sign(lz || 1) * (BOAT_HZ + hw);
        p[0] = b.x + nlx * cs + nlz * sn; p[2] = b.z - nlx * sn + nlz * cs;
        const nx = p[0] - b.x - dx, nz = p[2] - b.z - dz, nl = Math.hypot(nx, nz) || 1, vn = v[0] * nx / nl + v[2] * nz / nl; if (vn < 0) { v[0] -= vn * nx / nl; v[2] -= vn * nz / nl; }
    }
}
/** Moving web anchor point by id: 0..CAR_N-1 = under a flying car, 100+i = boat i's mast top. Null when it is gone (car wrapped). */
export function movingAnchor(id: number, t: number): V3 | null {
    if (id >= 100) { const b = boatAt(id - 100, t); return [b.x, b.y + BOAT_MAST, b.z]; }
    const c = carAt(id, t); return c.wrap ? null : [c.x, c.y + CAR_BOT, c.z];
}

/** Nearest car within reach of the hero (or -1); the parked car counts too. */
export function rideTarget(s: Sim): number {
    if (PILOT.i >= 0 && !PILOT.parked) return PILOT.i;
    let best = -1, bd = RIDE_RANGE;
    for (let i = 0; i < CAR_N; i++) { const c = carAt(i, s.t); if (c.wrap) continue; const d = Math.hypot(c.x - s.pos[0], (c.y + 0.6) - s.pos[1], c.z - s.pos[2]); if (d < bd) { bd = d; best = i; } }
    for (let i = 0; i < BOATS.length; i++) { const b = boatAt(i, s.t), d = Math.hypot(b.x - s.pos[0], b.z - s.pos[2]) - 3; if (Math.abs(b.y + 1 - s.pos[1]) < 5 && d < bd) { bd = d; best = 100 + i; } }   // boats too (Shifat: "boat can be entered too?")
    return best;
}
function stepRide(s: Sim, dt: number, input: Input, ev: Events): boolean {
    if (input.rideQ) {
        input.rideQ = false;
        if (PILOT.i >= 0 && !PILOT.parked) {   // hop out onto the roof; the car hovers where you left it
            PILOT.parked = true; PILOT.vx = PILOT.vy = PILOT.vz = 0;
            s.pos[0] = PILOT.x; s.pos[1] = PILOT.i >= 100 ? WATER_Y + BOAT_DECK + 1.1 : PILOT.y + CAR_TOP + 1.1; s.pos[2] = PILOT.z; s.vel = [0, 0, 0]; s.ground = true; (s as any).riding = false; ev.jump();
            return false;
        }
        const i = rideTarget(s);
        if (i >= 0) { const c: any = i >= 100 ? boatAt(i - 100, s.t) : carAt(i, s.t); Object.assign(PILOT, { i, x: c.x, y: c.y, z: c.z, yaw: c.yaw, vx: c.vx, vy: 0, vz: c.vz, parked: false, turn: 0 }); s.web = false; s.glideOn = false; s.wall = null; s.swim = false; s.dive = false; (s as any).riding = true; ev.attach(); }
    }
    if (!(PILOT.i >= 0 && !PILOT.parked)) { (s as any).riding = false; return false; }
    // flying: throttle along the camera heading, climb/dive with the camera pitch, Space/jump to climb straight up, strafe to slide sideways
    const k = input.keys; let mx = input.mx + ((k['d'] ? 1 : 0) - (k['a'] ? 1 : 0)), my = input.my + ((k['w'] ? 1 : 0) - (k['s'] ? 1 : 0));
    const ml = Math.hypot(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
    if (PILOT.i >= 100) {   // boat: throttle along the camera heading on the water surface, banks into turns, stays out at sea
        const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), rx = -fz, rz = fx, MAX = 24, a = Math.min(1, dt * 1.1);
        PILOT.vx += ((fx * my + rx * mx) * MAX - PILOT.vx) * a; PILOT.vz += ((fz * my + rz * mx) * MAX - PILOT.vz) * a;
        PILOT.x += PILOT.vx * dt; PILOT.z += PILOT.vz * dt; PILOT.y = WATER_Y; PILOT.vy = 0;
        const hs = Math.hypot(PILOT.vx, PILOT.vz); let dy2 = 0; if (hs > 1.5) { dy2 = Math.atan2(PILOT.vx, PILOT.vz) - PILOT.yaw; dy2 = Math.atan2(Math.sin(dy2), Math.cos(dy2)); PILOT.yaw += dy2 * Math.min(1, dt * 2.2); }
        PILOT.turn += (Math.max(-1, Math.min(1, dy2 * 2)) * Math.min(1, hs / 10) - PILOT.turn) * Math.min(1, dt * 3);
        if (PILOT.z > WATER_Z - 9) { PILOT.z = WATER_Z - 9; PILOT.vz = Math.min(0, PILOT.vz); }
        PILOT.x = Math.max(-SEA.xMax + 6, Math.min(SEA.xMax - 6, PILOT.x)); PILOT.z = Math.max(SEA.zMin + 6, PILOT.z);
        s.pos[0] = PILOT.x; s.pos[1] = WATER_Y + BOAT_DECK + 1.0; s.pos[2] = PILOT.z; s.vel = [PILOT.vx, 0, PILOT.vz]; s.ground = true; s.web = false; s.swim = false; s.safe = [PILOT.x, WATER_Y + BOAT_DECK + 1.0, PILOT.z];
        return true;
    }
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), rx = -fz, rz = fx, MAX = 42;
    const tx = (fx * my + rx * mx) * MAX, tz = (fz * my + rz * mx) * MAX, ty = (input.jumpHeld ? 14 : 0) + (-Math.sin(s.pitch - 0.25)) * Math.abs(my) * 22;
    const a = Math.min(1, dt * 1.6);
    PILOT.vx += (tx - PILOT.vx) * a; PILOT.vz += (tz - PILOT.vz) * a; PILOT.vy += (ty - PILOT.vy) * Math.min(1, dt * 2.5);
    PILOT.x += PILOT.vx * dt; PILOT.y += PILOT.vy * dt; PILOT.z += PILOT.vz * dt;
    const hs = Math.hypot(PILOT.vx, PILOT.vz); if (hs > 2) { let dy = Math.atan2(PILOT.vx, PILOT.vz) - PILOT.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); PILOT.yaw += dy * Math.min(1, dt * 4); }
    // keep the car out of buildings and above street / water, inside the world
    const floor = (PILOT.z < WATER_Z ? WATER_Y + 2.5 : 3);
    if (PILOT.y < floor) { PILOT.y = floor; PILOT.vy = Math.max(0, PILOT.vy); } if (PILOT.y > 220) { PILOT.y = 220; PILOT.vy = Math.min(0, PILOT.vy); }
    for (const b of blds) { const m = 2.6; if (PILOT.x > b.x0 - m && PILOT.x < b.x1 + m && PILOT.z > b.z0 - m && PILOT.z < b.z1 + m && PILOT.y < b.h + 1.4) {
        const l = PILOT.x - (b.x0 - m), r = (b.x1 + m) - PILOT.x, f = PILOT.z - (b.z0 - m), kk = (b.z1 + m) - PILOT.z, top = b.h + 1.4 - PILOT.y, mn = Math.min(l, r, f, kk, top);
        if (mn === top) { PILOT.y = b.h + 1.4; PILOT.vy = Math.max(0, PILOT.vy); } else if (mn === l) { PILOT.x = b.x0 - m; PILOT.vx = Math.min(0, PILOT.vx); } else if (mn === r) { PILOT.x = b.x1 + m; PILOT.vx = Math.max(0, PILOT.vx); } else if (mn === f) { PILOT.z = b.z0 - m; PILOT.vz = Math.min(0, PILOT.vz); } else { PILOT.z = b.z1 + m; PILOT.vz = Math.max(0, PILOT.vz); } } }
    const xl = PILOT.z < WATER_Z - 4 ? SEA.xMax : HALF - 3; PILOT.x = Math.max(-xl, Math.min(xl, PILOT.x)); PILOT.z = Math.max(SEA.zMin, Math.min(HALF - 3, PILOT.z));
    // the hero sits in the cabin and moves with the car
    s.pos[0] = PILOT.x; s.pos[1] = PILOT.y + 1.6; s.pos[2] = PILOT.z; s.vel = [PILOT.vx, PILOT.vy, PILOT.vz]; s.ground = false; s.web = false; s.swim = false;
    s.safe = [PILOT.x, Math.max(PILOT.y, 2), PILOT.z];
    return true;
}
/** Web anchor under the nearest suitable car ahead (or null). Same distance/aim rules as building anchors. */
function findCarAnchor(s: Sim, bestScore: number): { a: V3; sc: number; i: number } | null {
    const p = s.pos, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw); let out: { a: V3; sc: number; i: number } | null = null;
    for (let i = 0; i < CAR_N; i++) {
        const c = carAt(i, s.t); if (c.wrap) continue;
        const dx = c.x - p[0], dz = c.z - p[2], dh = Math.hypot(dx, dz) || 1, dy = c.y + CAR_BOT - p[1];
        if (dy < 6) continue; const dist = Math.hypot(dh, dy); if (dist < 12 || dist > 85) continue;
        const dot = (dx * fx + dz * fz) / dh; if (dot < 0.3 && dh > 8) continue;
        const sc = Math.abs(dist - 40) + (1 - Math.max(dot, 0)) * 50 - 6;   // slight preference: cars are a deliberate target when close to the aim
        if (sc < bestScore && (!out || sc < out.sc)) out = { a: [c.x, c.y + CAR_BOT, c.z], sc, i };
    }
    for (let i = 0; i < BOATS.length; i++) {
        const b = boatAt(i, s.t), dx = b.x - p[0], dz = b.z - p[2], dh = Math.hypot(dx, dz) || 1, dy = b.y + BOAT_MAST - p[1];
        if (dy < 4) continue; const dist = Math.hypot(dh, dy); if (dist < 8 || dist > 70) continue;
        const dot = (dx * fx + dz * fz) / dh; if (dot < 0.3 && dh > 6) continue;
        const sc = Math.abs(dist - 30) + (1 - Math.max(dot, 0)) * 50 - 8;
        if (sc < bestScore && (!out || sc < out.sc)) out = { a: [b.x, b.y + BOAT_MAST, b.z], sc, i: 100 + i };
    }
    return out;
}
function findAnchor(s: Sim, strict = false): V3 {
    const p = s.pos, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    let best: V3 | null = null, bs = 1e9;
    for (const b of blds) {
        const qx = Math.max(b.x0, Math.min(b.x1, p[0])), qz = Math.max(b.z0, Math.min(b.z1, p[2]));
        const dx = qx - p[0], dz = qz - p[2], dh = Math.hypot(dx, dz), dy = b.h - p[1];
        if (dy < 8 || dh < 10) continue;
        const dist = Math.hypot(dh, dy);
        if (dist < 16 || dist > 85) continue;
        const dot = (dx * fx + dz * fz) / dh;
        if (dot < 0.3) continue;
        const sc = Math.abs(dist - 40) + (1 - dot) * 50 + (dy > 75 ? 25 : 0);
        if (sc < bs) { bs = sc; const ox = -dx / dh, oz = -dz / dh; best = [qx + ox * 10, b.h + 3, qz + oz * 10]; }
    }
    if (Math.abs(p[0] - BRIDGE.x) < 150) for (const a of SEA_ANCHORS) {   // South Sea 3: bridge cables + tower tops take webs
        const dx = a[0] - p[0], dz = a[2] - p[2], dh = Math.hypot(dx, dz), dy = a[1] - p[1];
        if (dy < 8 || dh < 6) continue;
        const dist = Math.hypot(dh, dy); if (dist < 16 || dist > 85) continue;
        const dot = (dx * fx + dz * fz) / dh; if (dot < 0.3) continue;
        const sc = Math.abs(dist - 40) + (1 - dot) * 50;
        if (sc < bs) { bs = sc; best = [a[0], a[1], a[2]]; }
    }
    const car = findCarAnchor(s, bs);
    if (car) { const a = car.a as any; a.car = car.i; return a; }
    if (strict && !best) return null as any; // spring-shot needs a real building anchor, never empty air
    return best || [p[0] + fx * 24, p[1] + 26, p[2] + fz * 24];
}


// PLASMA WEB SHOT targeting: nearest live enemy near the aim direction with clear line of sight.
// Aim assist: a wide cone around the camera heading picks the target; the reticle (Scene) shows it before firing.
export function pickPlasmaTarget(s: Sim): Enemy | null {
    const p = s.pos, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    let best: Enemy | null = null, bs = 1e9;
    for (const e of s.enemies) {
        if (e.down > 0) continue;
        const dx = e.x - p[0], dz = e.z - p[2], d = Math.hypot(dx, dz), dy = Math.abs((e.boss ? targetY(e) : e.y) - p[1]);
        if (d < 2 || d > 42 || dy > 18) continue;
        const dot = (dx * fx + dz * fz) / d;
        if (dot < 0.35) continue;   // assist cone (~70 deg): not through buildings, not behind the hero
        if (!losClear(p[0], p[1] + 1.5, p[2], e.x, e.y + enemyBodyOffset(e), e.z)) continue;
        const sc = d * (0.4 + (1 - dot) * 8);   // strongly prefer what the camera points at, then nearer
        if (sc < bs) { bs = sc; best = e; }
    }
    return best;
}
const PLASMA_SPEED = 55, PLASMA_CAP = 3, BLAST_CAP = 6, BLAST_R = 8;
function spawnPlasma(s: Sim, tgt: Enemy) {
    if (s.plasma.length >= PLASMA_CAP) s.plasma.shift();   // cap concurrent bolts (low-end budget)
    const p = s.pos, ty = tgt.y + enemyBodyOffset(tgt);
    const ox = p[0] + Math.sin(s.yaw) * 0.6, oy = p[1] + 1.4, oz = p[2] + Math.cos(s.yaw) * 0.6;   // from the raised hands
    const d = norm([tgt.x - ox, ty - oy, tgt.z - oz]);
    s.plasma.push({ x: ox, y: oy, z: oz, vx: d[0] * PLASMA_SPEED, vy: d[1] * PLASMA_SPEED, vz: d[2] * PLASMA_SPEED, t: 0, tgt });
}
// visual-only death explosion: pooled blast at the bot's body, no damage, no chain reaction
function deathBlast(s: Sim, e: Enemy) {
    s.blasts.push({ x: e.x, y: e.y + enemyBodyOffset(e), z: e.z, t: 0, r: 5.5 });
    if (s.blasts.length > BLAST_CAP) s.blasts.shift();
}
function detonate(s: Sim, x: number, y: number, z: number, ev: Events) {
    s.blasts.push({ x, y, z, t: 0, r: BLAST_R });
    if (s.blasts.length > BLAST_CAP) s.blasts.shift();   // cap overlapping effects so repeated shots stay readable
    let any = false;
    for (const e of s.enemies) {
        if (e.down > 0) continue;
        const dx = e.x - x, dz = e.z - z, dy = (e.y + enemyBodyOffset(e)) - y, dh = Math.hypot(dx, dz);
        const d = Math.hypot(dh, dy);
        if (d > BLAST_R) continue;
        const k = 1 - d / BLAST_R;
        e.hp -= d < 2.5 ? 3 : 2;   // direct hit hits hardest
        e.hit = 0.5;
        const kk = 10 + 26 * k;   // radial knockback, strongest at the centre
        e.kb = [dx / (dh || 1) * kk, dz / (dh || 1) * kk];
        any = true; s.combo++; s.comboT = 1.2;
        if (e.hp <= 0) { e.down = 3; s.kos++; s.score += 2; ev.ko(); }
    }
    if (any) ev.hit();
    if (ev.blast) ev.blast(x, y, z);
}
// read-only HUD context: which actions would actually do something right now (same ranges the actions use)
export function actionCtx(s: Sim) {
    const p = s.pos, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw); let melee = false, shot = false, snare = false;
    for (const e of s.enemies) { if (e.down > 0) continue; const dx = e.x - p[0], dz = e.z - p[2], d = Math.hypot(dx, dz), dy = Math.abs((e.boss ? targetY(e) : e.y) - p[1]);
        if (!e.boss && d < 3.6 && dy < 3.5 && (d < 1.2 || (dx * fx + dz * fz) / (d || 1) > -0.1)) melee = true;   // close strike
        if (!e.boss && !melee && d < 16 && dy < 4.5 && !s.swim && !s.wall && losClear(p[0], p[1] + 1.5, p[2], e.x, e.y + enemyBodyOffset(e), e.z)) melee = true;   // web-pull strike range
        if (d < 24 && dy < 14 && losClear(p[0], p[1] + 1.5, p[2], e.x, e.y + enemyBodyOffset(e), e.z)) snare = true; }
    shot = !!pickPlasmaTarget(s);   // web shot lights when the plasma auto-target has a lock
    const grab = !s.swim && !s.wall && s.spring <= 0 && findAnchor(s, true) !== null;
    return { grab, melee, shot, snare: snare && !((s as any).snareCd > 0) };
}
let hitN: [number, number] | null = null, hitB = -1;
function collide(s: Sim, prevY: number) {
    const p = s.pos, v = s.vel; s.ground = false; hitN = null; hitB = -1;
    const hw = 0.5, hh = 1.0;
    for (let bi = 0; bi < blds.length; bi++) {
        const b = blds[bi];
        if (p[0] + hw <= b.x0 || p[0] - hw >= b.x1 || p[2] + hw <= b.z0 || p[2] - hw >= b.z1 || p[1] - hh > b.h + 0.05 || p[1] + hh <= (b.y0 ?? 0)) continue;
        if (prevY - hh >= b.h - 0.6 && v[1] <= 0.5) { p[1] = b.h + hh; if (v[1] < 0) v[1] = 0; s.ground = true; s.safe = [p[0], p[1], p[2]]; continue; }
        const l = p[0] + hw - b.x0, r = b.x1 - (p[0] - hw), f = p[2] + hw - b.z0, k = b.z1 - (p[2] - hw), m = Math.min(l, r, f, k);
        hitB = bi;
        if (m === l) { p[0] -= l; if (v[0] > 0) v[0] *= -0.1; hitN = [-1, 0]; } else if (m === r) { p[0] += r; if (v[0] < 0) v[0] *= -0.1; hitN = [1, 0]; }
        else if (m === f) { p[2] -= f; if (v[2] > 0) v[2] *= -0.1; hitN = [0, -1]; } else { p[2] += k; if (v[2] < 0) v[2] *= -0.1; hitN = [0, 1]; }
    }
    const lim = HALF - 3, xl = p[2] < WATER_Z - 4 ? SEA.xMax : lim;   // the open sea is wider than the city and runs far south
    if (p[0] > xl) { p[0] = xl; v[0] = Math.min(v[0], 0); } if (p[0] < -xl) { p[0] = -xl; v[0] = Math.max(v[0], 0); }
    if (p[2] > lim) { p[2] = lim; v[2] = Math.min(v[2], 0); } if (p[2] < SEA.zMin) { p[2] = SEA.zMin; v[2] = Math.max(v[2], 0); }
}

export const FLY = { swingCap: 46, swingBoost: 18, glideCap: 32, glideAcc: 22 };   // traversal tuning knobs
const FLY_SWING_CAP = 46, FLY_SWING_BOOST = 18, FLY_GLIDE_CAP = 32, FLY_GLIDE_ACC = 22, FLY_FLIGHT_CAP = 44, FLY_FLIGHT_ACC = 30;   /* Oct 29 9:15 PM 'speed up the glide, flight too': glide 22/14 -> 32/22, flight own cap 44/30 */   // traversal tuning (was 34 / 14 / 14 / 10): user asked for faster flight
export interface StepOptions { updateEnemies?: boolean; }
export function stepSim(s: Sim, dt: number, ev: Events, controls: Input = input, options: StepOptions = {}) {
    stepSimInner(s, dt, ev, controls, options);
    if (controls === input && (s as any).riding && PILOT.i >= 0 && !PILOT.parked) { s.pos[0] = PILOT.x; s.pos[1] = PILOT.i >= 100 ? WATER_Y + BOAT_DECK + 1.0 : PILOT.y + 1.6; s.pos[2] = PILOT.z; s.vel = [PILOT.vx, PILOT.vy, PILOT.vz]; s.ground = false; s.swim = false; s.dive = false; s.web = false; s.glideOn = false; s.wall = null; }
}
function stepSimInner(s: Sim, dt: number, ev: Events, controls: Input = input, options: StepOptions = {}) {
    const input = controls;
    if ((s as any).hitStop > 0) { (s as any).hitStop -= dt; if ((s as any).hitStop > 0) return; }
    const p = s.pos, v = s.vel, k = input.keys;
    { const ac = (s as any).anchorCar; if (ac >= 0 && (s.web || s.grappleFlight)) { const m = movingAnchor(ac, s.t); if (!m) { (s as any).anchorCar = -1; if (s.web) { s.web = false; ev.release(); } } else { s.anchor[0] = m[0]; s.anchor[1] = m[1]; s.anchor[2] = m[2]; } } else if (!s.web && !s.grappleFlight) (s as any).anchorCar = -1; }   // a web on a flying car rides with the car
    // vehicle entering removed (Shifat Oct 29, 4:32 PM: "Remove car & boat entering"); standing on / riding roofs and decks stays
    let mx = input.mx + ((k['d'] ? 1 : 0) - (k['a'] ? 1 : 0)), my = input.my + ((k['w'] ? 1 : 0) - (k['s'] ? 1 : 0));
    const ml = Math.hypot(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
    const turn = (k['arrowleft'] ? 1 : 0) - (k['arrowright'] ? 1 : 0);
    if (turn) { s.yaw += turn * 2.0 * dt; s.lastDrag = s.t; }
    if (k['arrowup'] || k['arrowdown']) { s.pitch = Math.max(-1.15, Math.min(1.35, s.pitch + ((k['arrowdown'] ? 1 : 0) - (k['arrowup'] ? 1 : 0)) * dt)); s.lastDrag = s.t; }
    const swingHeld = input.swing;   // desktop pass: swing is held through input.swing only (right mouse hold / LT / touch button)
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), rx = -fz, rz = fx;
    const stunned = s.landHard > 0;
    const wx = stunned ? 0 : fx * my + rx * mx, wz = stunned ? 0 : fz * my + rz * mx;

    if (input.swingQ && !s.web) {
        s.grappleFlight = false; s.webDepartB = s.wall ? s.wallB : undefined;
        { const sa = findAnchor(s, true); s.anchorReal = !!sa; s.anchor = sa || findAnchor(s); (s as any).anchorCar = (sa as any)?.car ?? -1; } s.web = true; s.webT = 0; s.rope = Math.max(12, len(sub(s.anchor, p))); s.swings++;
        const d = norm(sub(s.anchor, p)); v[0] += d[0] * 6; v[1] += d[1] * 4; v[2] += d[2] * 6; s.ground = false; s.wall = null; ev.attach();
    }
    input.swingQ = false;
    if (!swingHeld && s.web) { s.web = false; v[1] += 3; ev.release(); }
    let springAnchor: V3 | null = null;
    // web grab button: two-hand web to the nearest real building anchor, then the same spring travel as the spring jump
    if (input.grabQ) { input.grabQ = false; if (!s.swim && !s.wall && s.spring <= 0) springAnchor = findAnchor(s, true); }
    if (!springAnchor && input.jumpQ && !s.swim && !s.wall && (s.web || (swingHeld && !s.ground)) && s.spring <= 0) springAnchor = s.web ? (s.anchorReal ? s.anchor : null) : findAnchor(s, true);
    if (springAnchor) {
        // PROTOTYPE spring-shot jump (both hands): JUMP while the web is out, or JUMP while holding SWING in the air, springs toward the anchor
        input.jumpQ = false;
        (s as any).anchorCar = (springAnchor as any).car ?? ((springAnchor === s.anchor) ? (s as any).anchorCar ?? -1 : -1); s.anchor = springAnchor; s.grappleFlight = true;
        const d = norm(sub(s.anchor, p)); s.web = false; s.spring = 0.4; s.ground = false;
        v[0] = v[0] * 0.3 + d[0] * 24; v[1] = Math.max(v[1], 0) * 0.3 + d[1] * 24 + 7; v[2] = v[2] * 0.3 + d[2] * 24; ev.jump(); ev.attach();
    }
    if (input.jumpQ) {
        input.jumpQ = false; s.grappleFlight = false;
        if (s.swim) { s.dive = !s.dive; }   // jump on the surface dives (user message 10:18, WhatsApp); underwater it surfaces. Shore exit: swim into the shore (below).
        else
        if (s.wall) { const n = s.wall; v[0] = n[0] * 11; v[2] = n[1] * 11; v[1] = 21.5; s.wall = null; s.wallT = 0.25; s.ground = false; ev.jump(); }
        else if (s.ground) { v[1] = JUMP_V; s.ground = false; const g0 = s as any; g0.pressT = 0; g0.pressGl = false; g0.pressGround = true; g0.dblUsed = false; g0.glideMode = false; ev.jump(); }
        else if (s.web) { s.web = false; v[1] += 8; ev.jump(); }
        else { const g0 = s as any; g0.pressT = 0; g0.pressGl = !!g0.glideMode; g0.pressGround = false; }   // air press: tap/hold decided on release (see Space scheme below)
    }
    const gl = s as any;
    /* Space scheme (Shifat Oct 29 9:15 PM): tap = jump, double tap = double jump, hold = glide,
       hold while gliding = flight, tap while gliding = cancel glide + direct jump. Glide stays on after release until a tap or landing. */
    const HOLD = 0.18, heldNow = !!(input.jumpHeld || k[' ']);
    if (input.jumpCancelled) { input.jumpCancelled = false; gl.pressT = undefined; }
    if (s.ground || s.web || s.wall || s.swim) { gl.glideMode = false; if (!s.ground || s.web) gl.dblUsed = false; if (s.ground) gl.dblUsed = false; }
    if (gl.pressT !== undefined) {
        if (s.web || s.swim || s.wall || (s.ground && !gl.pressGround)) gl.pressT = undefined;
        else {
            if (heldNow) gl.pressT += dt;
            if (!gl.pressGl && gl.pressT >= HOLD && !s.ground) gl.glideMode = true;   // hold = glide (from a ground jump too)
            if (input.jumpReleased || !heldNow) {
                if (gl.pressT < HOLD && !gl.pressGround) {
                    if (gl.pressGl) { gl.glideMode = false; v[1] = Math.max(v[1], 0) + JUMP_V * 0.8; s.grappleFlight = false; ev.jump(); }   // tap while gliding: cancel + direct jump
                    else if (!gl.dblUsed) { gl.dblUsed = true; v[1] = Math.max(v[1], 0) * 0.3 + JUMP_V * 0.92; s.grappleFlight = false; ev.jump(); }   // second tap: double jump
                }
                gl.pressT = undefined;
            }
        }
    }
    input.jumpReleased = false;
    gl.flightBoost = gl.pressT !== undefined && !!gl.pressGl && gl.pressT >= HOLD && heldNow && !!gl.glideMode;   // hold while gliding = flight
    const prevY = p[1];
    s.spring = Math.max(0, s.spring - dt); s.shotT = Math.max(0, s.shotT - dt);
    s.airT = (!s.ground && !s.swim && !s.wall && !s.web) ? s.airT + dt : 0;
    // Auto-glide during free flight after the launch beat. Mid-air JUMP cancels until the next flight.
    if (s.ground || s.web || s.wall || s.swim || s.spring > 0) (s as any).glideBlocked = false;
    s.glideOn = !s.ground && !s.web && !s.wall && !s.swim && s.spring <= 0 && !!gl.glideMode;
    if (s.glideOn) s.grappleFlight = false;
    const wasGround = s.ground, landVy = v[1];
    if (s.landHard > 0) s.landHard -= dt;
    s.wallT = Math.max(0, s.wallT - dt);
    { /* Shifat Oct 31 11:02 AM: hold Space while swimming / diving = burst up out of the water straight into flight (keep holding to climb) */
      const sh = s as any; if (s.swim && heldNow) sh.swimHold = (sh.swimHold || 0) + dt; else sh.swimHold = 0;
      if (s.swim && sh.swimHold >= 0.3) { sh.swimHold = 0; s.swim = false; s.dive = false; sh.leapT = 0.8; s.ground = false; v[1] = Math.max(v[1], 0) + 26; gl.glideMode = true; gl.pressGl = true; gl.pressGround = false; gl.pressT = HOLD; ev.jump(); } }
    if (!s.web) { const ocean = p[2] < WATER_Z, lake = isLakeWater(p[0], p[2]), zone = ocean || lake, surface = waterSurfaceAt(p[0], p[2], s.t); (s as any).leapT = Math.max(0, ((s as any).leapT || 0) - dt); if (zone && p[1] < surface + 0.9 && !((s as any).leapT > 0)) s.swim = true; else if (!zone || p[1] > surface + 1.4) { s.swim = false; s.dive = false; } } else { s.swim = false; s.dive = false; }
    if (s.swim) { s.wall = null; s.ground = false; if (input.dodgeQ) { input.dodgeQ = false; s.dive = !s.dive; } }
    // Manual pitch is retained on walls; no forced leveling.
    if (s.swim) {
        const inLake = isLakeWater(p[0], p[2]), surface = waterSurfaceAt(p[0], p[2], s.t);
        const lakeDepth = inLake ? Math.max(1.2, surface - lakeFloorAt(p[0], p[2]) - 1.05) : 5;
        const sp = s.dive ? (inLake ? 5.8 : 7) : (inLake ? 7.2 : 9.5), a = Math.min(1, dt * (inLake ? 3.2 : 4));
        const cur = s.dive ? Math.sin(s.t * 0.3) * 0.9 : 0;   // underwater current: gentle sideways drift while diving (same phase as the bubble drift)
        v[0] += (wx * sp + cur - v[0]) * a; v[2] += (wz * sp - v[2]) * a;
        if (inLake && p[2] < WATER_Z) { const pl = poolAt(p[0], p[2]); if (pl && pl.fx !== undefined) { p[0] += pl.fx * 2.4 * dt; p[2] += (pl.fz as number) * 2.4 * dt; } }   // South Sea 2b: the island river carries you downstream
        const target = s.dive ? (inLake ? Math.max(lakeFloorAt(p[0], p[2]) + 1.05, surface - lakeDepth) : -5) : surface + 0.25;
        v[1] += ((target - p[1]) * 3 - v[1]) * Math.min(1, dt * (inLake ? 5.5 : 5));
        s.runPhase += Math.hypot(v[0], v[2]) * dt * 0.8;
        if (p[2] > WATER_Z - 1.2 && wz > 0.3 && p[1] > WATER_Y - 2.5) { p[1] = 1; p[2] = WATER_Z + 1.3; v[0] = v[1] = v[2] = 0; s.swim = false; s.dive = false; s.ground = true; }
        else if (p[2] < WATER_Z + 1 && Math.hypot(wx, wz) > 0.3 && p[1] > surface - 2.5) {   // South Sea 2: generic shore / ladder exit onto the island beach, a pool bank, the dock (and later the harbor)
            const wl = Math.hypot(wx, wz), ax = p[0] + wx / wl * 1.6, az = p[2] + wz / wl * 1.6, sf = seaSurface(ax, az, 1e9);
            if (sf !== null && sf > surface + 0.15 && sf < surface + 10.5 && !poolAt(ax, az)) { p[0] = ax; p[1] = sf + 1; p[2] = az; v[0] = v[1] = v[2] = 0; s.swim = false; s.dive = false; s.ground = true; (s as any).leapT = 0.4; }
        }
    } else if (s.wall && !s.web) {
        const n = s.wall, tx = -n[1], tz = n[0];
        const push = -(wx * n[0] + wz * n[1]), lat = wx * tx + wz * tz;
        if (push < -0.3) { s.wall = null; s.wallT = 0.2; v[0] = n[0] * 3; v[2] = n[1] * 3; v[1] = 0; }
        else {
            const up = push > 0.3 ? push * 16 : 0;
            v[0] = tx * lat * 18 - n[0] * 2; v[2] = tz * lat * 18 - n[1] * 2; v[1] += (up - v[1]) * Math.min(1, dt * 12);
            s.runPhase += (Math.abs(up) + Math.abs(lat) * 18) * dt * 0.52;
        }
    } else if (s.ground && !s.web) {
        const a = Math.min(1, dt * 13); v[0] += (wx * WALK_V - v[0]) * a; v[2] += (wz * WALK_V - v[2]) * a; v[1] = 0;   // 10:19 PM 'make walk faster': 15 -> 22 m/s, quicker pickup
    } else {
        // Glide lift balances gravity during descent; keep ordinary gravity through the rising launch.
        if (s.glideOn && (s as any).flightBoost) v[1] += (12 - v[1]) * (1 - Math.exp(-3.5 * dt));   // flight climbs faster (was 8)
        else if (s.glideOn && v[1] <= 0) v[1] += (-4.2 - v[1]) * (1 - Math.exp(-6 * dt));
        else v[1] -= (s.web ? G_WEB : v[1] > 0 ? G : G_FALL) * dt;
        const air = s.web ? 12 : 7; v[0] += wx * air * dt; v[2] += wz * air * dt;
        if (s.web) { const hs0 = Math.hypot(v[0], v[2]); const px = hs0 > 2 ? v[0] / hs0 : fx, pz = hs0 > 2 ? v[2] / hs0 : fz; const boost = hs0 < FLY_SWING_CAP ? FLY_SWING_BOOST : 0; v[0] += px * boost * dt; v[2] += pz * boost * dt; }
        if (!s.web) { const dr = Math.pow(0.992, dt * 60); v[0] *= dr; v[2] *= dr; }
    }
    p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;
    if (s.web) {
        s.webT += dt; s.rope = Math.max(10, s.rope - 1.5 * dt);
        const a = s.anchor, d = sub(p, a), l = len(d);
        if (a[1] - p[1] > 25 && l < s.rope - 0.5 && s.webT < 1.6) { // low start: reel the hero up toward the anchor (zip)
            const kk = 34 * dt; v[0] -= d[0] / l * kk; v[1] -= d[1] / l * kk; v[2] -= d[2] / l * kk; s.rope = Math.max(12, Math.min(s.rope, l + 3));
        }
        if (l > s.rope) {
            const n: V3 = [d[0] / l, d[1] / l, d[2] / l];
            p[0] = a[0] + n[0] * s.rope; p[1] = a[1] + n[1] * s.rope; p[2] = a[2] + n[2] * s.rope;
            const vn = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
            if (vn > 0) { v[0] -= n[0] * vn; v[1] -= n[1] * vn; v[2] -= n[2] * vn; }
        }
    }
    if (s.glideOn) { const fl = !!(s as any).flightBoost, cap = fl ? FLY_FLIGHT_CAP : FLY_GLIDE_CAP, acc = fl ? FLY_FLIGHT_ACC : FLY_GLIDE_ACC; const hs = Math.hypot(v[0], v[2]); if (hs < cap) { const fx2 = Math.sin(s.yaw), fz2 = Math.cos(s.yaw); v[0] += fx2 * acc * dt; v[2] += fz2 * acc * dt; } }

    collide(s, prevY);
    (s as any).onCar = -1; collideCars(s, prevY, dt);
    (s as any).onBoat = -1; collideBoats(s, prevY, dt);
    if (s.webDepartB !== undefined) { const b = blds[s.webDepartB]; if (!s.web || !b || p[0] < b.x0 - 1.2 || p[0] > b.x1 + 1.2 || p[2] < b.z0 - 1.2 || p[2] > b.z1 + 1.2 || p[1] - 1 > b.h + 0.2) s.webDepartB = undefined; }
    // Hero side-wall contact ends web travel and enters wall-running mode.
    // A distant anchor attaching is not contact; roofs remain normal landings.
    if (hitN && !s.ground && !s.swim && s.wallT <= 0 && !stunned && hitB !== s.webDepartB && (s.web || s.grappleFlight)) {
        const wasWeb = s.web; s.web = false; s.spring = 0; s.grappleFlight = false;
        s.glideOn = false; (s as any).glideLatch = false; s.airT = 0;
        s.wall = hitN; s.wallB = hitB; s.vaulted = 0;
        v[0] = -hitN[0] * 2; v[1] = 0; v[2] = -hitN[1] * 2;
        if (wasWeb) ev.release();
    }
    if (hitN && !s.web && !s.ground && s.wallT <= 0 && !stunned) {
        const push = -(wx * hitN[0] + wz * hitN[1]);
        if (s.wall || push > 0.5) { if (!s.wall) { s.vaulted = 0; } s.wall = hitN; s.wallB = hitB; }
    } else if (hitN && !s.web && s.ground && p[1] > 1.2) { /* standing on a roof, touching wall: no attach */ s.wall = null; }
    else if (hitN && !s.web && s.wallT <= 0 && !stunned && p[1] <= 1.05 && -(wx * hitN[0] + wz * hitN[1]) > 0.5) { s.wall = hitN; s.wallB = hitB; v[1] = 0.1; p[1] = 1.06; }
    else if (!hitN) s.wall = null;

    if (s.wall && s.wallB >= 0) { const b = blds[s.wallB]; if (p[1] - 1.0 >= b.h - 0.5) { const n = s.wall; p[1] = b.h + 1.02; p[0] -= n[0] * 1.1; p[2] -= n[1] * 1.1; v[0] = v[1] = v[2] = 0; s.wall = null; s.vaulted++; s.ground = true; s.safe = [p[0], p[1], p[2]]; } }
    if (s.ground && s.web && p[1] > 1.2) s.web = false;
    if (s.swim) { const floor = isLakeWater(p[0], p[2]) ? lakeFloorAt(p[0], p[2]) + 1.05 : seabedAt(p[0], p[2]) + 1; if (p[1] < floor) { p[1] = floor; if (v[1] < 0) v[1] = 0; } }
    const parkFloor = parkH(p[0], p[2]), bridgeFloor = bridgeSurfaceAt(p[0], p[2]);
    let gy = 1.0 + Math.max(parkFloor, bridgeFloor ?? -Infinity), onLand = p[2] >= WATER_Z, seaG = false;
    if (p[2] < WATER_Z + 40) { const sf = seaSurface(p[0], p[2], prevY - 1.0); if (sf !== null && (!onLand || sf + 1 > gy)) { gy = sf + 1.0; onLand = true; seaG = true; } }   // South Sea: island ground, dock, bridge deck, harbor platform
    if ((p[1] <= gy + 0.0005 || (gy < 1 && v[1] <= 0 && p[1] - gy < 0.35) || (seaG && wasGround && v[1] <= 0.5 && p[1] - gy < 1.2)) && onLand && !s.swim) { // street level, valley floor, or the footbridge/ramp: snaps down gentle slopes
        if (!s.ground) { s.ground = true; }
        p[1] = gy; if (v[1] < 0) v[1] = 0;
    }
    if (s.ground || s.swim || s.wall || s.glideOn) s.grappleFlight = false;
    if (s.ground && !wasGround && landVy < -7) {
        const imp = -landVy; s.land = Math.min(1, imp / 30); const hard = imp > 26;
        s.landHard = hard ? 0.45 : 0;
        if (hard) { v[0] *= 0.35; v[2] *= 0.35; }   // Shifat Oct 31 11:01 AM: no HP loss from landing / falling
        ev.land(hard);
    }
    const sp = len(v); if (sp > s.maxSpeed) s.maxSpeed = sp;
    const hs = Math.hypot(v[0], v[2]);
    if (s.wall) { s.ang = Math.atan2(-s.wall[0], -s.wall[1]); } else if (hs > 1.5) { let da = Math.atan2(v[0], v[2]) - s.ang; da = Math.atan2(Math.sin(da), Math.cos(da)); s.ang += da * Math.min(1, dt * 12); }
    if (s.ground) s.runPhase += hs * dt * 0.9;
    s.land = Math.max(0, s.land - dt * 3);
    stepCombat(s, dt, ev, controls, options);
    // Gentle heading assist only during forward movement, never during manual look or at rest.
    if (!s.camHeld && s.t - s.lastDrag > 2.5 && hs > 2.5 && my > 0.2 && Math.abs(mx) < 0.15 && !s.wall) {
        let da = Math.atan2(v[0], v[2]) - s.yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); s.yaw += Math.max(-0.6 * dt, Math.min(0.6 * dt, da * (1 - Math.exp(-0.7 * dt))));
    }
    for (let i = 0; i < s.orbs.length; i++) {
        const o = s.orbs[i];
        if (Math.hypot(o[0] - p[0], o[1] - p[1], o[2] - p[2]) < 5.5) { s.score++; s.orbs[i] = newOrb(s); ev.orb(); }
    }
}
export const buildings = blds;
const BODY_OFF = [0.8, 0.3, 1.05, 1.7];   // kind 3 torso height follows its 1.8 scale (1.2 at scale 1.25)
const BOSS_BODY_OFF = BOSS_BODY_OFFSET;
export const enemyBodyOffset = (e: Enemy) => e.boss ? BOSS_BODY_OFF : BODY_OFF[e.kind ?? 0];
const targetY = (e: Enemy) => e.y + enemyBodyOffset(e);
// Multi-Target Shock Web Attack only; regular melee move timing and tuning stay separate.
export const SNARE = { MAX_TARGETS: 5, RANGE: 24, VERTICAL_RANGE: 14, TOTAL: 1.65, GATHER_END: 0.9, SHOCK_START: 0.6, IMPACT: 0.15, HIT_RANGE: 5.5, GROUP_RADIUS: 2.4, PULL_SPEED: 30, DAMAGE: 3, KNOCKBACK: 18, HIT_STOP: 0.10, SHAKE: 0.34 } as const;
const losClear = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => { const dx = bx - ax, dy = by - ay, dz = bz - az; for (const b of blds) { let t0 = 0, t1 = 1; const lo = [b.x0, -1e9, b.z0], hi = [b.x1, b.h, b.z1], o = [ax, ay, az], d = [dx, dy, dz]; let ok = true; for (let k = 0; k < 3; k++) { if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo[k] || o[k] > hi[k]) { ok = false; break; } } else { let ta = (lo[k] - o[k]) / d[k], tb = (hi[k] - o[k]) / d[k]; if (ta > tb) { const q = ta; ta = tb; tb = q; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) { ok = false; break; } } } if (ok) return false; } return true; };   // exact segment vs AABB (slab test)
const insideBA = (x: number, z: number, y: number) => { for (const b of blds) if (b.h + 2 > y && x > b.x0 - 0.6 && x < b.x1 + 0.6 && z > b.z0 - 0.6 && z < b.z1 + 0.6) return true; return false; };   // air units are only blocked by buildings taller than their altitude
const insideB = (x: number, z: number) => { for (const b of blds) if (x > b.x0 - 0.6 && x < b.x1 + 0.6 && z > b.z0 - 0.6 && z < b.z1 + 0.6) return true; return z < -900 && harborVoid(x, z); };   // harbor bots never walk off the platform into a canal
const inRoof = (e: Enemy, x: number, z: number) => !!e.roof && x > e.roof.x0 + 1 && x < e.roof.x1 - 1 && z > e.roof.z0 + 1 && z < e.roof.z1 - 1;
// ===== COMBAT CHOREOGRAPHY (v0.77) =====
// Move ids: 1 jab, 2 cross, 3 spin hook kick, 4 launcher (rising knee+uppercut), 5 aerial side-kick spike, 6 web-pull flying kick, 7 web-yank slam.
// Refs: Muybridge "Two men boxing" 1887 plate (jab/cross weight shift), Taekwondo 540 hook (spin kick chamber + lean),
// Capoeira armada (spin with torso counter-lean), Marvel's Spider-Man 2 combat (launch -> air follow-up, web pull/yank).
// Each move: dur (s), hit time, cancel time (buffered next move may start), stop distance for the gap-closing lunge.
export const MOVES: Record<number, { dur: number; hit: number; cancel: number; stop: number; dmg: number; kb: number; lift: number; shake: number; stopT: number; reach: number }> = {
    1: { dur: 0.30, hit: 0.10, cancel: 0.17, stop: 1.75, dmg: 1, kb: 6, lift: 0, shake: 0.10, stopT: 0.045, reach: 3.2 },
    2: { dur: 0.32, hit: 0.11, cancel: 0.19, stop: 1.75, dmg: 1, kb: 9, lift: 0, shake: 0.14, stopT: 0.05, reach: 3.0 },
    3: { dur: 0.48, hit: 0.24, cancel: 0.33, stop: 2.05, dmg: 1, kb: 16, lift: 2.5, shake: 0.24, stopT: 0.075, reach: 3.4 },
    4: { dur: 0.52, hit: 0.20, cancel: 0.30, stop: 1.65, dmg: 1, kb: 2, lift: 13.5, shake: 0.26, stopT: 0.08, reach: 3.2 },
    5: { dur: 0.50, hit: 0.26, cancel: 0.40, stop: 1.80, dmg: 2, kb: 7, lift: -24, shake: 0.30, stopT: 0.09, reach: 3.6 },
    6: { dur: 0.58, hit: 0.32, cancel: 0.42, stop: 1.90, dmg: 1, kb: 17, lift: 3, shake: 0.24, stopT: 0.07, reach: 3.6 },
    7: { dur: 0.52, hit: 0.20, cancel: 0.40, stop: 0, dmg: 0, kb: 0, lift: -28, shake: 0.18, stopT: 0.06, reach: 24 },
};
const bodyY = (e: Enemy) => e.y + ((e as any).ly || 0) + enemyBodyOffset(e);
function nearLifted(s: Sim, r: number, minLy = 1.2): Enemy | null {
    const p = s.pos; let best: Enemy | null = null, bd = r;
    for (const e of s.enemies) { if (e.down > 0 || e.boss || !(((e as any).ly || 0) > minLy)) continue; const d = Math.hypot(e.x - p[0], e.z - p[2]); if (d < bd && losClear(p[0], p[1] + 1.5, p[2], e.x, bodyY(e), e.z)) { bd = d; best = e; } }
    return best;
}
// pick the bot the chain should flow into: in front first, then nearest; returns [enemy, dist]
function comboTarget(s: Sim, r: number): [Enemy | null, number] {
    const p = s.pos, fx = Math.sin(s.ang), fz = Math.cos(s.ang); let best: Enemy | null = null, bs = 1e9, bdist = 0;
    for (const e of s.enemies) {
        if (e.down > 0 || e.boss) continue; const dx = e.x - p[0], dz = e.z - p[2], d = Math.hypot(dx, dz); if (d > r || Math.abs(bodyY(e) - p[1] - 0.5) > 4.5) continue;
        const front = (dx * fx + dz * fz) / (d || 1); const sc = d - front * 2.2; if (sc < bs) { bs = sc; best = e; bdist = d; }
    }
    return [best, bdist];
}
function comboStart(s: Sim, ev: Events, force: boolean): boolean {
    const sa = s as any;
    if (s.swim || s.wall || s.web) return false;
    // aerial follow-up: the bot we launched is still up -> leap after it
    const up = nearLifted(s, 9, sa.chain === 4 ? 0.3 : 1.2);
    if (up && (sa.chain === 4 || !s.ground)) { startMove(s, 5, up, ev); return true; }
    const [e, d] = comboTarget(s, 16);
    if (e && d > 5.8) { if (losClear(s.pos[0], s.pos[1] + 1.5, s.pos[2], e.x, bodyY(e), e.z)) { startMove(s, 6, e, ev); return true; } }
    if (e && d <= 5.8) { if (!s.ground) { startMove(s, 5, e, ev); return true; } sa.chain = ((sa.chainT > 0 ? sa.chain || 0 : 0) % 4) + 1; startMove(s, sa.chain, e, ev); return true; }
    if (force) { sa.chain = ((sa.chainT > 0 ? sa.chain || 0 : 0) % 2) + 1; startMove(s, s.ground ? sa.chain : 5, null, ev); return true; }   // whiff still reads as a strike
    return false;
}
function startMove(s: Sim, id: number, e: Enemy | null, ev: Events) {
    const sa = s as any, p = s.pos;
    sa.mv = { id, t: 0, e, hit: false, d0: e ? Math.hypot(e.x - p[0], e.z - p[2]) : 0, spin: id === 3 ? 1 : 0 };
    sa.mvQ = false; s.atkT = 0; s.shotT = 0; sa.kick = false; s.glideOn = false;
    if (id === 6 || id === 7) { sa.cWeb = { e, t: 0, mode: id === 6 ? 'pull' : 'yank' }; ev.attach(); }
    if (id === 5) {   // leap: reach the target's body height around the hit frame (hang-time juggle)
        const ty = e ? bodyY(e) + 0.4 : p[1] + 2.2; const dh = Math.max(1.2, Math.min(9, ty - p[1] + 0.6));
        s.vel[1] = Math.max(s.vel[1], Math.sqrt(2 * G * dh) * 0.92); s.ground = false;
    }
    if (id === 4) s.vel[1] = Math.max(s.vel[1], 5.5);   // launcher pops the hero off the ground a little
}
function stepMove(s: Sim, dt: number, ev: Events) {
    const sa = s as any, p = s.pos, v = s.vel;
    sa.chainT = Math.max(0, (sa.chainT || 0) - dt); sa.shake = Math.max(0, (sa.shake || 0) - dt * 1.6);
    if (sa.cWeb) { sa.cWeb.t += dt; if (sa.cWeb.t > 0.42 || !sa.cWeb.e || sa.cWeb.e.down > 0) sa.cWeb = null; }
    if (sa.flip) { sa.flip.t += dt; if (sa.flip.t >= sa.flip.dur) sa.flip = null; }
    const m = sa.mv; if (!m) return;
    const M = MOVES[m.id], e: Enemy | null = m.e && m.e.down <= 0 ? m.e : null;
    m.t += dt;
    // web pull: reel the bot in towards the hero for the first part of the move
    if (m.id === 6 && e && m.t < 0.26) { const dx = p[0] - e.x, dz = p[2] - e.z, d = Math.hypot(dx, dz); if (d > 2.6) { const st = Math.min(d - 2.6, 34 * dt), nx = e.x + dx / d * st, nz = e.z + dz / d * st; if (e.roof ? inRoof(e, nx, nz) : !insideB(nx, nz) && !inPk(nx, nz)) { e.x = nx; e.z = nz; } (e as any).ly = Math.max((e as any).ly || 0, 0.6 * Math.sin(Math.min(1, m.t / 0.26) * Math.PI)); } e.hit = Math.max(e.hit, 0.2); e.atk = 0; }
    // web yank: bot is held, then slammed down
    if (m.id === 7 && e) { e.hit = Math.max(e.hit, 0.2); e.atk = 0; if (m.t < M.hit) (e as any).vy = Math.max(((e as any).vy || 0), 1.5); }
    // face the target, smoothly
    if (e) { let da = Math.atan2(e.x - p[0], e.z - p[2]) - s.ang; da = Math.atan2(Math.sin(da), Math.cos(da)); s.ang += da * Math.min(1, dt * 22); }
    // gap-closing lunge: eased slide up to the hit frame (momentum carried, no teleport)
    if (e && M.stop > 0 && m.t < M.hit + 0.04) {
        const dx = e.x - p[0], dz = e.z - p[2], d = Math.hypot(dx, dz);
        if (d > M.stop) { const sp = Math.max(7, (m.d0 - M.stop) / Math.max(0.08, M.hit) * 1.25); const st = Math.min(d - M.stop, sp * dt); p[0] += dx / d * st; p[2] += dz / d * st; }
        if (m.id === 5) { const ty = bodyY(e) + 0.4; if (ty > p[1]) v[1] = Math.max(v[1], Math.min(16, (ty - p[1]) * 7)); }
    } else if (!e && m.t < M.hit && s.ground) { p[0] += Math.sin(s.ang) * 3.5 * dt; p[2] += Math.cos(s.ang) * 3.5 * dt; }   // whiff steps in
    if (s.ground) { const k = 1 - Math.min(1, dt * 12); v[0] *= k; v[2] *= k; }   // plant: strikes don't skate
    else if (m.id === 5 && m.t < M.hit + 0.1) v[1] = Math.max(v[1], -2);    // brief hang at the top of the aerial kick
    if (!m.hit && m.t >= M.hit) {
        m.hit = true;
        if (m.id === 7) { if (e) { const ea = e as any; ea.vy = M.lift; ea.slam = 1; const dx = p[0] - e.x, dz = p[2] - e.z, d = Math.hypot(dx, dz) || 1; e.kb = [dx / d * 9, dz / d * 9]; sa.shake = Math.max(sa.shake, M.shake); sa.hitStop = M.stopT; } }
        else {
            const fx = Math.sin(s.ang), fz = Math.cos(s.ang); let any = false;
            for (const o of s.enemies) {
                if (o.down > 0 || o.boss) continue; const dx = o.x - p[0], dz = o.z - p[2], d = Math.hypot(dx, dz), dy = bodyY(o) - (p[1] + 0.5);
                const reachOK = o === e ? d < M.reach + 0.8 : d < M.reach;
                if (!reachOK || Math.abs(dy) > (m.id === 5 ? 3.2 : 2.6) || (d > 1.2 && (dx * fx + dz * fz) / (d || 1) < (m.id === 3 ? -0.6 : -0.1))) continue;   // spin kick sweeps a wider arc
                const oa = o as any; o.hp -= M.dmg; o.hit = Math.max(o.hit, m.id >= 3 ? 0.55 : 0.32); o.atk = 0;
                const nx = d > 0.01 ? dx / d : fx, nz = d > 0.01 ? dz / d : fz; o.kb = [nx * M.kb, nz * M.kb];
                if (M.lift > 0) oa.vy = Math.max(oa.vy || 0, M.lift); else if (M.lift < 0) { oa.vy = M.lift; oa.slam = 1; }
                oa.hitDir = m.id; any = true; s.combo++; s.comboT = 1.4;
                if (o.hp <= 0) { o.down = 3; s.kos++; s.score += 2; ev.ko(); deathBlast(s, o); }
            }
            if (any) { ev.hit(); sa.hitStop = M.stopT; sa.shake = Math.max(sa.shake, M.shake); }
        }
    }
    if (sa.mvQ && m.t >= M.cancel) { sa.mv = null; sa.chainT = 0.9; if (!comboStart(s, ev, true)) sa.mv = null; return; }
    if (m.t >= M.dur) { sa.mv = null; sa.chainT = 0.75; }
}
// launched / slammed bots: vertical arc with juggle hang time, ground bounce + shake on slam
function enemyAir(s: Sim, e: Enemy, dt: number, ev: Events) {
    const ea = e as any; if (!(ea.ly > 0) && !(ea.vy > 0)) { ea.ly = 0; ea.vy = 0; return false; }
    const mainMove = (s as any).mv, ghostMove = companionSim && companionSim !== s ? (companionSim as any).mv : null;
    const juggled = (!!mainMove && mainMove.e === e && mainMove.id !== 7) || (!!ghostMove && ghostMove.e === e && ghostMove.id !== 7);
    if (juggled && ea.vy > 0) ea.vy *= 1 - Math.min(1, dt * 5);   // hang at the apex while the follow-up arrives
    ea.vy -= (juggled ? 9 : 26) * dt; ea.ly = (ea.ly || 0) + ea.vy * dt; ea.tumble = (ea.tumble || 0) + dt * (ea.slam ? 9 : 5);
    if (ea.ly <= 0) {
        const imp = -ea.vy; ea.ly = 0;
        if (imp > 9) {   // slam: bounce, damage once, camera kick
            ea.vy = imp * 0.22; if (ea.slam && e.down <= 0) { e.hp -= 1; e.hit = 0.6; if (e.hp <= 0) { e.down = 3; s.kos++; s.score += 2; ev.ko(); deathBlast(s, e); } ev.hit(); }
            ea.slam = 0; (s as any).shake = Math.max((s as any).shake || 0, Math.min(0.34, imp * 0.012)); if (ev.blast && imp > 20) ev.blast(e.x, e.y + 0.3, e.z);
        } else { ea.vy = 0; ea.tumble = 0; }
    }
    if (e.down <= 0) e.hit = Math.max(e.hit, 0.12);
    return true;
}
function bossRoofClamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
// Shifat Oct 29 "Boss should follow heroes & keep attacking": the boss is no longer leashed to the arena roof. When the hero is
// off the boss's current surface (another roof, the street, the park, mid-swing) it hover-dashes after them: short take-off, a
// propel that re-aims at the hero every frame (fast enough to keep up with a swing), and a landing on whatever is under the target
// (roof top, street, park slope; never the water). On the same surface it walks after the hero and melees; volleys and the chest
// beam keep firing on their usual cooldowns throughout. No pathfinding: it flies over buildings.
function bossLandY(x: number, z: number): { y: number; roof?: { x0: number; x1: number; z0: number; z1: number } } {
    for (const b of blds) if (x > b.x0 + 0.4 && x < b.x1 - 0.4 && z > b.z0 + 0.4 && z < b.z1 - 0.4) return { y: b.h + 1, roof: { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 } };
    for (const b of blds) if (x > b.x0 - 1.2 && x < b.x1 + 1.2 && z > b.z0 - 1.2 && z < b.z1 + 1.2) return { y: b.h + 1, roof: { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 } };   // hugging a wall: stand on that roof instead of clipping into it
    if (z < WATER_Z) { const sf = seaSurface(x, z, 1e9); return { y: (sf ?? HARBOR.y) + 1 }; }   // harbor platform / footbridges
    return { y: (inPk(x, z) ? parkH(x, z) : 0) + 1 };
}
function bossChaseTarget(e: Enemy, p: V3) {
    const dx = p[0] - e.x, dz = p[2] - e.z, d = Math.hypot(dx, dz) || 1, stand = 4.5;
    let tx = p[0] - dx / d * stand, tz = p[2] - dz / d * stand;
    if (isLakeWater(tx, tz)) { tx = p[0] - dx / d * 9; tz = p[2] - dz / d * 9; }
    if ((e as any).mini) { tx = Math.max(HARBOR.x0 + 4, Math.min(HARBOR.x1 - 4, tx)); tz = Math.max(HARBOR.z0 + 4, Math.min(HARBOR.z1 - 4, tz)); if (harborVoid(tx, tz)) { tx = p[0]; tz = p[2]; } return { tx, tz }; }
    tz = Math.max(tz, WATER_Z + 4);
    return { tx: Math.max(-HALF + 4, Math.min(HALF - 4, tx)), tz };
}
function stepBossFlight(s: Sim, e: Enemy, dt: number, p: V3, engaged: boolean) {
    const flight = e.flight; if (!flight) return;
    const ease = (t: number) => t * t * (3 - 2 * t);
    const fa = flight as any;
    // Shifat Oct 29: "Boss should only follow when we walk to boss zone". Aggro starts when the hero steps into the arena zone
    // (the arena roof plus 6 m, at roof height or above); it ends if the hero gets 90 m away, and the boss flies home to its roof.
    const ea = e as any, AR = (ea.arena || BOSS_ARENA) as typeof BOSS_ARENA;   // South Sea 4: the harbor mini-boss has its own arena roof
    const A = AR.roof, inZone = p[0] > A.x0 - 6 && p[0] < A.x1 + 6 && p[2] > A.z0 - 6 && p[2] < A.z1 + 6 && p[1] > AR.y - 5;
    if (inZone) ea.aggro = true; else if (ea.aggro && Math.hypot(p[0] - e.x, p[2] - e.z) > 90) ea.aggro = false;
    if (!ea.aggro) {
        const home = Math.hypot(e.x - AR.x, e.z - AR.z) < 4 && Math.abs(e.y - AR.y) < 1;
        if (flight.phase === 'grounded') {
            e.y = flight.baseY; flight.phaseT += dt;
            if (!home && flight.phaseT >= 0.7 && e.hit <= 0 && e.atk <= 0) { flight.startX = e.x; flight.startZ = e.z; flight.targetX = AR.x; flight.targetZ = AR.z; fa.cruise = Math.max(flight.baseY, AR.y) + BOSS_FLIGHT.altitude; fa.fromY = e.y; fa.homing = true; flight.phase = 'takeoff'; flight.phaseT = 0; }
            return;
        }
    } else fa.homing = false;
    const dH = Math.hypot(p[0] - e.x, p[2] - e.z), dV = p[1] - e.y;
    const heroOff = (() => { if (dH > 16 || Math.abs(dV) > 3.2) return true; if (e.roof) { const r = e.roof; return !(p[0] > r.x0 - 0.5 && p[0] < r.x1 + 0.5 && p[2] > r.z0 - 0.5 && p[2] < r.z1 + 0.5); } return false; })();
    if (flight.phase === 'grounded') {
        e.y = flight.baseY; flight.phaseT += dt;
        if (s.mode === 'play' && e.hit <= 0 && e.atk <= 0 && !fa.uniBusy && heroOff && flight.phaseT >= 0.7 && (ea.mini ? inHarbor(p[0], p[2], 6) : p[2] > WATER_Z - 2)) {
            const c = bossChaseTarget(e, p);
            flight.startX = e.x; flight.startZ = e.z; flight.targetX = c.tx; flight.targetZ = c.tz;
            fa.cruise = Math.max(flight.baseY, bossLandY(c.tx, c.tz).y, p[1]) + BOSS_FLIGHT.altitude * 0.8;
            flight.cycle++; flight.phase = 'takeoff'; flight.phaseT = 0; fa.fromY = e.y;
        }
        return;
    }
    flight.phaseT += dt;
    const cruise = fa.cruise ?? (flight.baseY + BOSS_FLIGHT.altitude), fromY = fa.fromY ?? flight.baseY;
    if (flight.phase === 'takeoff') {
        const t = Math.min(1, flight.phaseT / 0.55);
        e.y = fromY + (cruise - fromY) * ease(t);
        if (t >= 1) { flight.phase = 'hover'; flight.phaseT = 0; }
    } else if (flight.phase === 'hover') {
        e.y = cruise + Math.sin(flight.phaseT * 2.6) * 0.16;
        if (flight.phaseT >= 0.25) { flight.phase = 'propel'; flight.phaseT = 0; }
    } else if (flight.phase === 'propel') {
        // re-aim at the hero every frame and close in (or head home when not aggro); fast when far so a swinging hero can't simply outrun it
        const c = fa.homing ? { tx: AR.x, tz: AR.z } : bossChaseTarget(e, p); flight.targetX = c.tx; flight.targetZ = c.tz;
        const tx = c.tx - e.x, tz = c.tz - e.z, td = Math.hypot(tx, tz), sp = Math.min(34, 9 + td * 0.6) * dt;
        if (td > 1e-3) { const k = Math.min(1, sp / td); e.x += tx * k; e.z += tz * k; e.ang = Math.atan2(p[0] - e.x, p[2] - e.z); }
        const want = Math.max(bossLandY(e.x, e.z).y + 2.5, Math.min(cruise + 10, Math.max(bossLandY(c.tx, c.tz).y, fa.homing ? 0 : p[1]) + BOSS_FLIGHT.altitude * 0.8));
        fa.cruise = want; e.y += Math.max(-14 * dt, Math.min(14 * dt, want - e.y)) + Math.sin(flight.phaseT * 2.6) * 0.004;
        if (td < 1.2 || flight.phaseT > 9) { flight.phase = 'landing'; flight.phaseT = 0; flight.startX = e.x; flight.startZ = e.z; const L = bossLandY(e.x, e.z); fa.landY = L.y; fa.landRoof = L.roof; fa.fromY = e.y; }
    } else if (flight.phase === 'landing') {
        const t = Math.min(1, flight.phaseT / 0.6), ly = fa.landY ?? flight.baseY;
        e.y = (fa.fromY ?? e.y) + (ly - (fa.fromY ?? e.y)) * ease(t);
        if (t >= 1) { e.y = ly; flight.baseY = ly; e.roof = fa.landRoof; flight.phase = 'grounded'; flight.phaseT = 0; }
    }
}
function stepCombat(s: Sim, dt: number, ev: Events, controls: Input = input, options: StepOptions = {}) {
    const input = controls;
    const p = s.pos, v = s.vel;
    s.aimE = pickPlasmaTarget(s);   // contextual lock indicator: what a web shot would hit right now
    if (s.hp <= 0) { s.hp = 100; p[0] = s.safe[0]; p[1] = s.safe[1] + 0.5; p[2] = s.safe[2]; v[0] = v[1] = v[2] = 0; s.web = false; ev.fall(); }
    s.atkT = Math.max(0, s.atkT - dt); s.dodgeT = Math.max(0, s.dodgeT - dt); s.hurtT = Math.max(0, s.hurtT - dt); s.comboT = Math.max(0, s.comboT - dt);
    if (s.comboT === 0) s.combo = 0;
    if (s.hp > 0 && s.t - s.lastHit > 5 && s.hp < 100) s.hp = Math.min(100, s.hp + 6 * dt);
    const fa = s.ang, fx = Math.sin(fa), fz = Math.cos(fa);
    if (input.dodgeQ) {
        input.dodgeQ = false;
        if (s.dodgeT <= 0 && !s.web) { s.dodgeT = 0.38; const mx = input.mx + ((input.keys['d'] ? 1 : 0) - (input.keys['a'] ? 1 : 0)), my = input.my + ((input.keys['w'] ? 1 : 0) - (input.keys['s'] ? 1 : 0)); const yx = Math.sin(s.yaw), yz = Math.cos(s.yaw); let dx = yx * my - yz * mx, dz = yz * my + yx * mx; const dl = Math.hypot(dx, dz); if (dl < 0.1) { dx = -fx; dz = -fz; } else { dx /= dl; dz /= dl; } v[0] = dx * 18; v[2] = dz * 18;
            { const sa = s as any, fw = dx * fx + dz * fz, sd = dx * fz - dz * fx; sa.mv = null; sa.mvQ = false; sa.flip = { t: 0, dur: 0.5, ax: Math.abs(fw) > 0.55 ? 'x' : 'z', dir: Math.abs(fw) > 0.55 ? (fw < 0 ? -1 : 1) : (sd > 0 ? 1 : -1) }; if (s.ground) { v[1] = 7.5; s.ground = false; } } }
    }
      if (input.attackQ) {
          input.attackQ = false; const fShot = !!input.shotQ, fMelee = !!input.meleeQ; input.shotQ = false; input.meleeQ = false;
          const sa = s as any;
          if (sa.mv) { if (!fShot) sa.mvQ = true; }   // buffered: the next move starts at this move's cancel point, so the chain flows
          else if (s.atkT <= 0) {
              // web-yank: a web shot at a bot that is airborne (launched) yanks it down into the street
              const lifted = fShot ? nearLifted(s, 22) : null;
              if (lifted) startMove(s, 7, lifted, ev);
              else if (fShot || !comboStart(s, ev, fMelee)) {
                  if (!fMelee) {
                      s.atkT = 0.32; s.shotE = null;
                      if (s.aimE) { s.shotT = 0.3; s.shotTgt = [s.aimE.x, s.aimE.y + enemyBodyOffset(s.aimE), s.aimE.z]; spawnPlasma(s, s.aimE); s.shotE = null; }
                  }
              }
          }
      }
      stepMove(s, dt, ev);
    // Each actor's simulator runs its own Multi-Target Shock Web Attack: gather, grip its bound web, discharge, then recover.
    { const sa = s as any; sa.snareCd = Math.max(0, (sa.snareCd || 0) - dt);
      if (controls.specialQ) { controls.specialQ = false; if (!(sa.snareCd > 0) && !(sa.snareT > 0) && !(s.landHard > 0) && !s.swim && !s.wall) { const L = s.enemies.filter((e) => e.down <= 0 && Math.hypot(e.x - p[0], e.z - p[2]) < 24 && Math.abs((e.boss ? targetY(e) : e.y) - p[1]) < 14 && losClear(p[0], p[1] + 1.5, p[2], e.x, e.y + enemyBodyOffset(e), e.z)).sort((a, b) => Math.hypot(a.x - p[0], a.z - p[2]) - Math.hypot(b.x - p[0], b.z - p[2])).slice(0, SNARE.MAX_TARGETS); if (L.length) { sa.snareList = L; sa.snareT = SNARE.TOTAL; sa.snareCd = 9; s.atkT = 0; s.shotT = 0; ev.attach(); } } }
      if (sa.snareT > 0) { const before = sa.snareT; sa.snareT = Math.max(0, sa.snareT - dt); const L = sa.snareList as Enemy[];
        if (sa.snareT > SNARE.IMPACT) { for (const e of L) { if (e.down > 0) continue; e.hit = Math.max(e.hit, 0.3); e.atk = 0; e.kb[0] = 0; e.kb[1] = 0;
          if (sa.snareT > SNARE.GATHER_END) { const dx = p[0] - e.x, dz = p[2] - e.z, d = Math.hypot(dx, dz); if (d > SNARE.GROUP_RADIUS) { const st = Math.min(d - SNARE.GROUP_RADIUS, SNARE.PULL_SPEED * dt), nx = e.x + dx / d * st, nz = e.z + dz / d * st; if ((e.roof ? inRoof(e, nx, nz) : !insideB(nx, nz) && !inPk(nx, nz)) && losClear(e.x, e.y + 0.5, e.z, nx, e.y + 0.5, nz)) { e.x = nx; e.z = nz; } } }
        } }
        if (before > SNARE.IMPACT && sa.snareT <= SNARE.IMPACT) { let any = false; for (const e of L) { if (e.down > 0) continue; const dx = e.x - p[0], dz = e.z - p[2], d = Math.hypot(dx, dz); if (d < 5.5 && losClear(p[0], p[1] + 1.5, p[2], e.x, e.y + enemyBodyOffset(e), e.z)) { e.hp -= 3; e.hit = 0.75; e.atk = 0; const nx = d > 0.01 ? dx / d : Math.sin(s.ang), nz = d > 0.01 ? dz / d : Math.cos(s.ang); e.kb = [nx * SNARE.KNOCKBACK, nz * SNARE.KNOCKBACK]; any = true; s.combo++; s.comboT = 1.2; if (e.hp <= 0) { e.down = 3; s.kos++; s.score += 2; ev.ko(); deathBlast(s, e); } } } if (any) { ev.hit(); sa.hitStop = SNARE.HIT_STOP; sa.shake = Math.max(sa.shake || 0, SNARE.SHAKE); } }
        if (sa.snareT <= 0) { sa.snareT = 0; sa.snareList = []; } }
    }
    if (options.updateEnemies !== false) {
    let atkN = 0; for (const e0 of s.enemies) if (e0.atk > 0) atkN++;
    for (let i = 0; i < s.enemies.length; i++) {
        const e = s.enemies[i], isBoss = !!e.boss;
        const sa = s as any, snareBound = e.down <= 0 && sa.snareT > SNARE.IMPACT && sa.snareList?.includes(e);
        const airb = snareBound ? false : enemyAir(s, e, dt, ev);
        if ((e as any).uni && (e.down > 0 || e.hit > 0.5)) { const u = (e as any).uni; if (u.phase === 'fire') ev.shot?.('uniStop', u.ox, u.oy, u.oz); (e as any).uni = undefined; (e as any).uniCd = ESHOT.UNI_CD; }   // env-iter3 F: a staggered or downed boss loses its beam
        if (e.down > 0) { e.down -= dt; if (e.down <= 0) { if (e.boss) { s.enemies.splice(i, 1); i--; } else s.enemies[i] = spawnEnemy(s); } continue; }
        if (snareBound) { e.atk = 0; e.kb[0] = 0; e.kb[1] = 0; continue; }
        e.hit = Math.max(0, e.hit - dt);
        if (airb) { const kx = e.kb[0] * dt, kz = e.kb[1] * dt; if (e.roof ? inRoof(e, e.x + kx, e.z + kz) : !insideB(e.x + kx, e.z + kz) && !inPk(e.x + kx, e.z + kz)) { e.x += kx; e.z += kz; } e.kb[0] *= 0.92; e.kb[1] *= 0.92; e.atk = 0; continue; }
        if (!e.boss && e.atk <= 0 && Math.hypot(e.x - p[0], e.z - p[2]) > 100) { s.enemies[i] = spawnEnemy(s); continue; }   // bosses are never re-placed: they chase the hero instead   // preserve boss type when re-placing far actors near the hero
        const kx = e.kb[0] * dt, kz = e.kb[1] * dt; if (Math.abs(kx) + Math.abs(kz) > 0.001 && (e.roof ? inRoof(e, e.x + kx, e.z + kz) : !insideB(e.x + kx, e.z + kz) && !inPk(e.x + kx, e.z + kz))) { e.x += kx; e.z += kz; } e.kb[0] *= 0.85; e.kb[1] *= 0.85;
        let dx = p[0] - e.x, dz = p[2] - e.z, d = Math.hypot(dx, dz), dy = Math.abs(p[1] - e.y);
        if (isBoss) {
            stepBossFlight(s, e, dt, p, e.hit <= 0);
            dx = p[0] - e.x; dz = p[2] - e.z; d = Math.hypot(dx, dz); dy = Math.abs(p[1] - e.y);
        }
        if ((isBoss ? ((e as any).aggro || (d < 54 && dy < 18)) : d < (e.air ? 32 : 26)) && (e.air || isBoss || dy < 5) && e.hit <= 0) {
            e.ang = Math.atan2(dx, dz);
            if (e.air) e.y += Math.max(-5 * dt, Math.min(5 * dt, Math.max(2, p[1]) - e.y));   // drones descend/climb to the hero's height
            if (d > (isBoss ? 5.0 : 2.0) && e.atk <= 0 && (!isBoss || e.flight?.phase === 'grounded')) { const free = !!e.air && insideBA(e.x, e.z, e.y); const sp = (isBoss ? 3.4 : 4.2) * dt, nx = e.x + dx / d * sp, nz = e.z + dz / d * sp; if (e.roof ? inRoof(e, nx, e.z) : (free || !(e.air ? insideBA(nx, e.z, e.y) : insideB(nx, e.z))) && (e.air || !inPk(nx, e.z))) e.x = nx; if (e.roof ? inRoof(e, e.x, nz) : (free || !(e.air ? insideBA(e.x, nz, e.y) : insideB(e.x, nz))) && (e.air || !inPk(e.x, nz))) e.z = nz; }
            if (d <= (isBoss ? 5.3 : 2.4) && e.atk <= 0 && (!e.air || dy < 3) && (!isBoss || dy < 16) && atkN < (e.air ? 1 : 2) && ((s as any).windT ?? 0) <= s.t) { e.atk = isBoss ? 1.3 : 0.7 + (i % 3) * 0.12; atkN++; (s as any).windT = s.t + 0.45; } // telegraph; at most 2 enemies wind up at once (staggered, not one synchronized burst), drones wait to be at the hero's height
        }
        enemyRanged(s, e, i, isBoss, d, dt, ev);
        if (e.atk > 0) {
            e.atk -= dt;
            if (e.atk <= 0) {
                const dd = Math.hypot(p[0] - e.x, p[2] - e.z);
                if (dd < (isBoss ? 6.3 : 2.9) && Math.abs(p[1] - e.y) < (isBoss ? 18 : 3) && s.dodgeT <= 0) { s.hp -= isBoss ? 20 : 12; s.hurtT = 0.3; s.lastHit = s.t; ev.hurt(); }
                e.atk = isBoss ? -2.2 : -1.2;
            }
        } else if (e.atk < 0) e.atk = Math.min(0, e.atk + dt);
    }
    }
    // plasma bolts: gentle homing toward the locked enemy, detonate on enemy/building/ground or timeout
    for (let i = s.plasma.length - 1; i >= 0; i--) {
        const b = s.plasma[i]; b.t += dt;
        if (b.tgt && b.tgt.down <= 0) {
            const ty = b.tgt.y + enemyBodyOffset(b.tgt), d = norm([b.tgt.x - b.x, ty - b.y, b.tgt.z - b.z]);
            const sp = Math.hypot(b.vx, b.vy, b.vz), turn = Math.min(1, dt * 7);   // limited turn: tracks without wild curves
            b.vx += (d[0] * sp - b.vx) * turn; b.vy += (d[1] * sp - b.vy) * turn; b.vz += (d[2] * sp - b.vz) * turn;
        }
        const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt, nz = b.z + b.vz * dt;
        let boom = b.t > 1.4;
        if (!boom) for (const e of s.enemies) { if (e.down > 0) continue; if (Math.hypot(e.x - nx, e.z - nz) < (e.boss ? BOSS_HIT_RADIUS : 1.6) && Math.abs((e.y + enemyBodyOffset(e)) - ny) < (e.boss ? BOSS_HIT_HALF_HEIGHT : 2.4)) { boom = true; break; } }
        if (!boom) for (const bd of blds) { if (nx > bd.x0 && nx < bd.x1 && nz > bd.z0 && nz < bd.z1 && ny < bd.h) { boom = true; break; } }
        if (!boom) { const sf = nz < WATER_Z ? seaSurface(nx, nz, ny) : null, gy = sf !== null ? sf + 1.0 : nz < WATER_Z ? WATER_Y : 1.0 + parkH(nx, nz); if (ny <= gy - 0.85) boom = true; }
        if (boom) { detonate(s, nx, ny, nz, ev); s.plasma.splice(i, 1); } else { b.x = nx; b.y = ny; b.z = nz; }
    }
    if (options.updateEnemies !== false) stepEnemyShots(s, dt, ev);
    for (let i = s.blasts.length - 1; i >= 0; i--) { s.blasts[i].t += dt; if (s.blasts[i].t > 0.85) s.blasts.splice(i, 1); }
}

// ---- env-iter3 F: Iron Man-style enemy fire (see ESHOT above) ----
function chestOf(e: Enemy) { return e.y + enemyBodyOffset(e) + (e.boss ? 1.2 : 0.25); }
/** Where the raised right palm is (world), from the enemy's facing. Regular robots ~0.55 m right/0.6 m forward; boss scaled up. */
export function enemyPalm(e: Enemy): V3 {
    const k = e.boss ? 3.2 : (e.kind === 3 ? 1.5 : 1), fx = Math.sin(e.ang), fz = Math.cos(e.ang);
    return [e.x + fx * 0.6 * k - fz * 0.5 * k, e.y + enemyBodyOffset(e) + 0.45 * k, e.z + fz * 0.6 * k + fx * 0.5 * k];
}
function hurtHero(s: Sim, dmg: number, ev: Events) {
    if (s.dodgeT > 0 || s.mode !== 'play') return false;
    s.hp -= dmg; s.hurtT = 0.3; s.lastHit = s.t; ev.hurt(); return true;
}
function fireBolt(s: Sim, e: Enemy, boss: boolean, ev: Events) {
    const sh = s.eshots || (s.eshots = []); if (sh.length >= ESHOT.MAX) return;
    const o = enemyPalm(e), p = s.pos, v = s.vel, sp = boss ? ESHOT.BOSS_SPEED : ESHOT.SPEED;
    const tgt: V3 = [p[0], p[1] + 0.9, p[2]];
    const tf = Math.min(1.2, Math.hypot(tgt[0] - o[0], tgt[1] - o[1], tgt[2] - o[2]) / sp);   // lead the target by its current velocity (dodge by changing direction)
    tgt[0] += v[0] * tf; tgt[1] += Math.max(-6, Math.min(6, v[1])) * tf * 0.5; tgt[2] += v[2] * tf;
    const dx = tgt[0] - o[0], dy = tgt[1] - o[1], dz = tgt[2] - o[2], l = Math.hypot(dx, dy, dz) || 1;
    sh.push({ x: o[0], y: o[1], z: o[2], vx: dx / l * sp, vy: dy / l * sp, vz: dz / l * sp, t: 0, boss, dead: 0 });
    (s as any).eshotLast = s.t; ev.shot?.('bolt', o[0], o[1], o[2]);
}
function enemyRanged(s: Sim, e: Enemy, i: number, isBoss: boolean, d: number, dt: number, ev: Events) {
    const ea = e as any, p = s.pos, sa = s as any;
    ea.rpCd = Math.max(0, (ea.rpCd ?? (1.2 + (i % 7) * 0.45)) - dt);
    if (isBoss) ea.uniCd = Math.max(0, (ea.uniCd ?? 5) - dt);
    const busy = e.hit > 0 || e.atk > 0 || s.mode !== 'play' || sa.snareList?.includes(e);
    // unibeam (boss only)
    if (isBoss) {
        const u: Unibeam | undefined = ea.uni;
        if (u) {
            u.t += dt; const cy = chestOf(e); u.ox = e.x + Math.sin(u.yaw) * 1.6; u.oy = cy; u.oz = e.z + Math.cos(u.yaw) * 1.6;
            const wantYaw = Math.atan2(p[0] - e.x, p[2] - e.z), dh = Math.hypot(p[0] - e.x, p[2] - e.z), wantPitch = Math.atan2(p[1] + 0.9 - cy, Math.max(1, dh));
            if (u.phase === 'charge') { u.yaw = wantYaw; u.pitch = wantPitch; e.ang = wantYaw; if (u.t >= ESHOT.UNI_CHARGE) { u.phase = 'fire'; u.t = 0; ev.shot?.('uniStart', u.ox, u.oy, u.oz); } }
            else {
                let dyaw = Math.atan2(Math.sin(wantYaw - u.yaw), Math.cos(wantYaw - u.yaw)); const mt = ESHOT.UNI_TURN * dt; dyaw = Math.max(-mt, Math.min(mt, dyaw)); u.yaw += dyaw; e.ang = u.yaw;   // sweeps after the hero, slower than a swing
                u.pitch += Math.max(-mt, Math.min(mt, wantPitch - u.pitch));
                u.tick -= dt;
                const cx = Math.sin(u.yaw) * Math.cos(u.pitch), cyy = Math.sin(u.pitch), cz = Math.cos(u.yaw) * Math.cos(u.pitch);
                const hx = p[0] - u.ox, hy = p[1] + 0.9 - u.oy, hz = p[2] - u.oz, along = hx * cx + hy * cyy + hz * cz;
                { const a2 = Math.max(0, Math.min(ESHOT.UNI_LEN, along)); ev.shot?.('uniMove', u.ox + cx * a2, u.oy + cyy * a2, u.oz + cz * a2); }   // sound follows the nearest point of the sweeping beam
                if (along > 0 && along < ESHOT.UNI_LEN && u.tick <= 0) { const px = hx - cx * along, py = hy - cyy * along, pz = hz - cz * along; if (Math.hypot(px, py, pz) < ESHOT.UNI_R && losClear(u.ox, u.oy, u.oz, p[0], p[1] + 0.9, p[2])) { if (hurtHero(s, ESHOT.UNI_DMG, ev)) u.tick = 0.4; } }
                if (u.t >= ESHOT.UNI_FIRE) { ev.shot?.('uniStop', u.ox, u.oy, u.oz); ea.uni = undefined; ea.uniCd = ESHOT.UNI_CD + Math.random() * 3; ea.rpCd = Math.max(ea.rpCd, 1.5); }
            }
            return;
        }
        if (!busy && ea.uniCd <= 0 && d > 8 && d < 46 && e.flight?.phase !== 'propel' && losClear(e.x, chestOf(e), e.z, p[0], p[1] + 0.9, p[2])) {
            ea.uni = { phase: 'charge', t: 0, yaw: Math.atan2(p[0] - e.x, p[2] - e.z), pitch: 0, ox: e.x, oy: chestOf(e), oz: e.z, tick: 0 } as Unibeam; ev.shot?.('uniCharge', e.x, chestOf(e), e.z); return;
        }
    }
    // repulsor: charge (palm glow) -> fire; bosses fire a 3-shot volley
    if (ea.rpT > 0) {
        if (busy && !isBoss) { ea.rpT = 0; ea.rpN = 0; return; }   // staggered or knocked: the shot is lost
        e.ang = Math.atan2(p[0] - e.x, p[2] - e.z);
        ea.rpT -= dt;
        if (ea.rpT <= 0) {
            fireBolt(s, e, isBoss, ev); ea.rpN = (ea.rpN || 1) - 1;
            if (ea.rpN > 0) ea.rpT = 0.18; else { ea.rpT = 0; ea.rpCd = isBoss ? 2.4 + Math.random() * 1.0 : 2 + Math.random(); }
        }
        return;
    }
    if (busy || ea.rpCd > 0 || s.dive) return;
    if (d < (isBoss ? 9 : ESHOT.RANGE_MIN) || d > (isBoss ? 46 : ESHOT.RANGE)) return;
    if (Math.abs(p[1] - e.y) > (isBoss ? 30 : 22)) return;
    if (s.t - (sa.eshotLast ?? -9) < ESHOT.MIN_GAP) return;
    let charging = 0; for (const o of s.enemies) if ((o as any).rpT > 0) charging++; if (charging >= 3) return;
    const o = enemyPalm(e); if (!losClear(o[0], o[1], o[2], p[0], p[1] + 0.9, p[2])) { ea.rpCd = 0.6; return; }
    ea.rpT = ESHOT.CHARGE; ea.rpN = isBoss ? 3 : 1; ev.shot?.('charge', o[0], o[1], o[2]);
}
function stepEnemyShots(s: Sim, dt: number, ev: Events) {
    const sh = s.eshots; if (!sh || !sh.length) return;
    const p = s.pos, sa = s as any, shockOn = sa.snareT > 0;
    for (let i = sh.length - 1; i >= 0; i--) {
        const b = sh[i];
        if (b.dead > 0) { b.dead += dt; if (b.dead > 0.25) sh.splice(i, 1); continue; }   // short pop flash, then free the slot
        b.t += dt;
        const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt, nz = b.z + b.vz * dt;
        let hit = false, stop = b.t > ESHOT.LIFE;
        // Web Shock pops incoming bolts around the hero
        if (!stop && shockOn && Math.hypot(nx - p[0], ny - (p[1] + 0.9), nz - p[2]) < 6.5) stop = true;
        if (!stop) { const cx = p[0], cy = p[1] + 0.9, cz = p[2]; const ax = b.x - cx, ay = b.y - cy, az = b.z - cz, bx = nx - b.x, by = ny - b.y, bz = nz - b.z, bb = bx * bx + by * by + bz * bz || 1; const tt = Math.max(0, Math.min(1, -(ax * bx + ay * by + az * bz) / bb)); if (Math.hypot(ax + bx * tt, ay + by * tt, az + bz * tt) < ESHOT.HIT_R && s.dodgeT <= 0) { hit = true; stop = true; } }   // swept test: fast bolts cannot tunnel through
        if (!stop) for (const bd of blds) { if (nx > bd.x0 && nx < bd.x1 && nz > bd.z0 && nz < bd.z1 && ny < bd.h) { stop = true; break; } }
        if (!stop) { const sf = nz < WATER_Z ? seaSurface(nx, nz, ny) : null, gy = sf !== null ? sf + 1.0 : nz < WATER_Z ? WATER_Y : 1.0 + parkH(nx, nz); if (ny <= gy - 0.9) stop = true; }
        if (hit) hurtHero(s, b.boss ? ESHOT.BOSS_DMG : ESHOT.DMG, ev);
        if (stop && b.t <= ESHOT.LIFE) ev.shot?.('impact', nx, ny, nz);
        if (stop) { b.dead = 0.0001; if (!hit) { b.x = nx; b.y = ny; b.z = nz; } } else { b.x = nx; b.y = ny; b.z = nz; }
    }
}
export function stepBeacon(s: Sim, ev: Events) {
    const p = s.pos, b = s.beacon;
    if (Math.hypot(b[0] - p[0], b[1] - p[1], b[2] - p[2]) < 8) { s.beaconN++; s.score += 5; s.beacon = newBeacon(s); ev.orb(); }
}

// Hero HD pass (env-iter2, Shifat Oct 29: "heroes look better res than everything else always in all devices").
// The world keeps rendering exactly as before (same adaptive pixel ratio, outline, FXAA, bloom, lake copy) but into an offscreen
// target ("world RT"). The canvas itself runs at the device's native pixel ratio (capped at 2). A final pass upscales the world RT
// onto the canvas (bilinear, like the browser's own canvas upscale did before), restores the world depth, and then redraws ONLY the
// heroes (Shadow + Ghost) at native resolution on top, depth-tested against the world so trees/buildings still hide them.
// Opt-out for A/B: ?hd=0.
import * as THREE from 'three';

export const HERO_LAYER = 2;
const OFF = typeof location !== 'undefined' && /[?&]hd=0\b/.test(location.search);

export const HD = {
    enabled: !OFF,
    on: false,                 // active this frame (canvas ratio > world ratio or FXAA-free heroes wanted)
    worldRatio: 1, canvasRatio: 1,
    rt: null as THREE.WebGLRenderTarget | null,
    depth: null as THREE.DepthTexture | null,
    roots: new Set<THREE.Object3D>(),
};
const _css = new THREE.Vector2();

/** Native ratio the heroes are drawn at: the device pixel ratio, capped at 2, never below the world's own ratio. */
export function heroRatio(world: number) { return Math.max(world, Math.min(2, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1))); }

/** Replaces gl.setPixelRatio(want) for the world: the canvas runs at the hero ratio, the world RT at `want`. */
export function applyRatio(gl: THREE.WebGLRenderer, want: number) {
    HD.worldRatio = want;
    const canvas = HD.enabled ? heroRatio(want) : want;
    HD.canvasRatio = canvas;
    HD.on = HD.enabled;
    if (Math.abs(gl.getPixelRatio() - canvas) > 0.001) gl.setPixelRatio(canvas);
}

/** The world's drawing size (what gl.getDrawingBufferSize returned before this pass existed). */
export function worldBufferSize(gl: THREE.WebGLRenderer, out: THREE.Vector2) {
    if (!HD.on) return gl.getDrawingBufferSize(out);
    gl.getSize(_css);
    return out.set(Math.max(1, Math.floor(_css.x * HD.worldRatio)), Math.max(1, Math.floor(_css.y * HD.worldRatio)));
}

const _ws = new THREE.Vector2();
/** Where the world's final image goes: the world RT while the pass is on, else the canvas (null). */
export function worldTarget(gl: THREE.WebGLRenderer): THREE.WebGLRenderTarget | null {
    if (!HD.on) return null;
    worldBufferSize(gl, _ws);
    if (!HD.rt) {
        HD.rt = new THREE.WebGLRenderTarget(_ws.x, _ws.y, { depthBuffer: false, stencilBuffer: false, samples: 0, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
        HD.rt.texture.generateMipmaps = false;   // NoColorSpace: holds the already display-encoded frame byte-for-byte
    } else if (HD.rt.width !== _ws.x || HD.rt.height !== _ws.y) HD.rt.setSize(_ws.x, _ws.y);
    return HD.rt;
}

export function registerHero(root: THREE.Object3D) { HD.roots.add(root); return () => { HD.roots.delete(root); }; }

/** Max anisotropy + trilinear mipmaps for a hero texture (heroes only; the environment keeps its own settings). */
export function crispHeroTexture(tex: THREE.Texture | null | undefined, gl?: THREE.WebGLRenderer) {
    if (!tex) return;
    const max = gl ? gl.capabilities.getMaxAnisotropy() : 8;
    tex.anisotropy = Math.max(tex.anisotropy, Math.min(16, max || 8));
    tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
}

/* #3 submerged hero parts (Shifat 2:32 PM + 2:53 PM 'heroes' submerged body parts aren't visible / weird blue thingy in ponds'): the water surface writes
   depth, so a diving hero vanished behind it. Below the water line each hero fragment now (a) takes the water's colour by the length of its underwater
   light path (Beer-Lambert style, clear near the surface, deep teal further down) and (b) pulls its depth up to just in front of the water surface on the
   camera ray, so the surface no longer hides it while real rocks/walls in front still do. Only hero fragments pay for this (no change to the water or
   world shaders, no early-z loss there). Scene sets uWL (water surface under the hero, -1e4 when not in water) and uWC each frame. */
export const HERO_WATER = { uWL: { value: -1e4 }, uWC: { value: new THREE.Color('#1a6f85') }, uPV: { value: new THREE.Matrix4() } };
const patched = new WeakSet<THREE.Material>();
function patchWater(m: THREE.Material) {
    if (patched.has(m)) return; patched.add(m);
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey.bind(m);
    m.onBeforeCompile = (sh, r) => {
        prev.call(m, sh, r);
        Object.assign(sh.uniforms, HERO_WATER);
        sh.vertexShader = 'varying vec3 vHwW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vHwW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        const end = sh.fragmentShader.lastIndexOf('}');
        sh.fragmentShader = 'varying vec3 vHwW; uniform float uWL; uniform vec3 uWC; uniform mat4 uPV;\n' + sh.fragmentShader.slice(0, end) + `
  float hwD = gl_FragCoord.z;
  if (vHwW.y < uWL) {
    vec3 hwC = cameraPosition; bool hwAbove = hwC.y > uWL;
    vec3 hwS = hwAbove ? hwC + (vHwW - hwC) * ((hwC.y - uWL) / max(hwC.y - vHwW.y, 1e-3)) : hwC;
    float hwPath = length(vHwW - hwS) + (uWL - vHwW.y) * 0.6;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uWC, (1.0 - exp(-hwPath * 0.3)) * 0.8);
    if (hwAbove) { vec3 hwP = hwS + normalize(hwC - hwS) * (0.5 - 0.07 * min(length(vHwW - hwS), 6.0));   /* keeps the hero's own front/back order (farther parts land nearer the surface) so no z-fight speckle */ vec4 hwQ = uPV * vec4(hwP, 1.0); hwD = min(hwD, clamp((hwQ.z / hwQ.w) * 0.5 + 0.5, 0.0, 1.0)); }
  }
  gl_FragDepth = hwD;
}`;
    };
    m.customProgramCacheKey = () => prevKey() + '|heroWater1';
    m.needsUpdate = true;
}

const COMP_FS = `uniform sampler2D tWorld; uniform sampler2D tDepth; varying vec2 vUv;
void main(){ gl_FragColor = vec4(texture2D(tWorld, vUv).rgb, 1.0); gl_FragDepth = texture2D(tDepth, vUv).r; }`;

export function createHeroComposite() {
    const mat = new THREE.ShaderMaterial({
        uniforms: { tWorld: { value: null }, tDepth: { value: null } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: COMP_FS, depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth, toneMapped: false,
    });
    const qs = new THREE.Scene(), q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); q.frustumCulled = false; qs.add(q);
    const qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    let frame = 0;
    const lights: THREE.Object3D[] = [];
    const heroMeshes: THREE.Mesh[] = [];
    const hidden: THREE.Mesh[] = [];
    const mats = new Set<THREE.Material>();
    const saved = new Map<THREE.Material, [boolean, number, number]>();
    const retag = (scene: THREE.Scene) => {
        lights.length = 0; scene.traverse((o) => { if ((o as THREE.Light).isLight) { o.layers.enable(HERO_LAYER); lights.push(o); } });
        heroMeshes.length = 0; mats.clear();
        HD.roots.forEach((r) => r.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { o.layers.set(HERO_LAYER); heroMeshes.push(m); (Array.isArray(m.material) ? m.material : [m.material]).forEach(patchWater); }   /* Shifat 9:58 AM 'draw heroes HD only': hero meshes live ONLY on the hero layer, so the dpr-1 world pass skips them and they are drawn once, here */ }));
    };
    function render(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
        if (!HD.on || !HD.rt || !HD.depth) return;
        if ((frame++ % 30) === 0 || heroMeshes.length === 0) retag(scene);
        const oldShadow = gl.shadowMap.autoUpdate, oldAuto = gl.autoClear, oldMask = camera.layers.mask, oldBg = scene.background, oldTarget = gl.getRenderTarget();
        try {
            mat.uniforms.tWorld.value = HD.rt.texture; mat.uniforms.tDepth.value = HD.depth;
            gl.setRenderTarget(null); gl.autoClear = false;
            HERO_WATER.uPV.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            gl.render(qs, qc);   // world image + world depth onto the native-res canvas
            // heroes again, native res, over their own low-res copy (polygon offset wins the tie with their own world depth)
            hidden.length = 0;
            for (const m of heroMeshes) {
                const mm = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.Material[];
                if (mm.some((x) => x.transparent && x.blending !== THREE.NoBlending && x.opacity < 0.999)) continue;   // fading (Ghost blink): drawn here as-is, no polygon offset   // fading (e.g. Ghost blink): leave the world copy alone
                for (const x of mm) mats.add(x);
            }
            saved.clear(); mats.forEach((x) => { saved.set(x, [x.polygonOffset, x.polygonOffsetFactor, x.polygonOffsetUnits]); x.polygonOffset = true; x.polygonOffsetFactor = -2; x.polygonOffsetUnits = -2; });
            gl.shadowMap.autoUpdate = false;
            scene.background = null;
            camera.layers.set(HERO_LAYER);
            gl.render(scene, camera);
        } finally {
            saved.forEach((v, x) => { x.polygonOffset = v[0]; x.polygonOffsetFactor = v[1]; x.polygonOffsetUnits = v[2]; }); saved.clear(); mats.clear();
            gl.shadowMap.autoUpdate = oldShadow;
            for (const m of hidden) m.visible = true;
            camera.layers.mask = oldMask; scene.background = oldBg; gl.autoClear = oldAuto; gl.setRenderTarget(oldTarget);
        }
    }
    return { render, dispose: () => { mat.dispose(); q.geometry.dispose(); HD.rt?.dispose(); HD.rt = null; } };
}

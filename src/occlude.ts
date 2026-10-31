import * as THREE from 'three';
/* Upgrade #5 (Oct 29 plan "street camera gets blocked by robots up close"): robots and pedestrians that stand between the camera and
   the hero, or right against the lens, dissolve with a screen-door dither so the hero is never hidden. Shader-only (no sorting, no
   transparency cost), works on instanced meshes. Heroes are untouched. */
export const OCC = { uOccHero: { value: new THREE.Vector3(0, -999, 0) } };
export function occludeFade(sh: any) {
    sh.uniforms.uOccHero = OCC.uOccHero;
    sh.vertexShader = 'varying vec3 vOccW; varying vec3 vOccO; varying float vOccHz; uniform vec3 uOccHero;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
    { vec4 op = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
    op = instanceMatrix * op;
    #endif
    vOccW = (modelMatrix * op).xyz;
    vec4 oo = vec4(0.0, 0.9, 0.0, 1.0);
    #ifdef USE_INSTANCING
    oo = instanceMatrix * oo;
    #endif
    vOccO = (modelMatrix * oo).xyz;
    vec3 hb = uOccHero + normalize(uOccHero - cameraPosition) * 4.0; vec4 hc = projectionMatrix * viewMatrix * vec4(hb, 1.0);   /* ghost depth = 4 m behind the hero: the hero and the ground at its feet draw over the ghost, no z-fight */ vOccHz = clamp((hc.z / hc.w) * 0.5 + 0.5 + 0.002, 0.0, 0.9999); }`);
    sh.fragmentShader = 'varying vec3 vOccW; varying vec3 vOccO; varying float vOccHz; uniform vec3 uOccHero;\n' + sh.fragmentShader.replace('void main() {', `void main() {
    float occA = 1.0;
    { vec3 oc = cameraPosition, oh = uOccHero, seg = oh - oc; float L2 = max(dot(seg, seg), 1e-3);
      float t = clamp(dot(vOccO - oc, seg) / L2, 0.0, 1.0); float dseg = length(vOccO - (oc + seg * t));   /* 12:02 AM: test the robot's own centre, so a robot hides WHOLE instead of leaving shredded pieces */
      float behind = 1.0 - smoothstep(0.78, 0.95, t);   // only between the lens and the hero, not past the hero
      float fight = smoothstep(2.5, 4.5, length(vOccO - oh));   /* Shifat Oct 31 1:57 PM 'enemy near camera not visible': a robot within ~4 m of the hero is the one being fought - never hidden */
      float f = max((1.0 - smoothstep(1.2, 1.6, dseg)) * behind * fight, 1.0 - smoothstep(1.3, 1.7, length(vOccO - oc)));   // only a robot squarely on the line of sight, or right in the lens (< ~1.5 m), is cut
      occA = mix(1.0, 0.22, smoothstep(0.3, 0.6, f)); }`).replace('#include <opaque_fragment>', `#include <opaque_fragment>
    if (occA < 0.99) gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.62, 0.78, 0.95), 0.55); gl_FragColor.a *= occA; gl_FragDepth = occA < 0.99 ? max(gl_FragCoord.z, vOccHz) : gl_FragCoord.z;   /* Shifat 2:05 PM 'just made transparent': a blocking robot turns to glass instead of vanishing; its depth is pushed just behind the hero, so the hero always draws over it while the city behind still hides it */`);
}

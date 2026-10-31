// Post-processing: FXAA (plus sharpened variant) and the ink outline pass. Moved verbatim from Scene.tsx.
export const FXAA_FS = `uniform sampler2D tDiffuse; uniform vec2 uRes; varying vec2 vUv;
float lum(vec3 c){ return dot(sqrt(max(c, 0.0)), vec3(0.299, 0.587, 0.114)); }
void main(){
  vec2 px = 1.0 / uRes;
  vec3 cM = texture2D(tDiffuse, vUv).rgb;
  vec3 cNW = texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * px).rgb, cNE = texture2D(tDiffuse, vUv + vec2(1.0, -1.0) * px).rgb;
  vec3 cSW = texture2D(tDiffuse, vUv + vec2(-1.0, 1.0) * px).rgb, cSE = texture2D(tDiffuse, vUv + vec2(1.0, 1.0) * px).rgb;
  float lM = lum(cM), lNW = lum(cNW), lNE = lum(cNE), lSW = lum(cSW), lSE = lum(cSE);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float dr = max((lNW + lNE + lSW + lSE) * 0.25 * 0.125, 1.0 / 128.0);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + dr);
  dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * px;
  vec3 a = 0.5 * (texture2D(tDiffuse, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tDiffuse, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tDiffuse, vUv + dir * -0.5).rgb + texture2D(tDiffuse, vUv + dir * 0.5).rgb);
  float lb = lum(b);
  vec3 col = (lb < lMin || lb > lMax) ? a : b;
  gl_FragColor = vec4(col, 1.0);
}`;
export const FXAA_SHARP_FS = FXAA_FS.replace('uniform vec2 uRes;', 'uniform vec2 uRes; uniform sampler2D tDepth; uniform float uNear; uniform float uFar; uniform float uSharp;')
    .replace('  gl_FragColor = vec4(col, 1.0);\n}', `  float sd = texture2D(tDepth, vUv).x;
  float szn = sd * 2.0 - 1.0, sz = (2.0 * uNear * uFar) / (uFar + uNear - szn * (uFar - uNear));
  float sk = uSharp * (1.0 - smoothstep(6.0, 28.0, sz)) * step(sd, 0.99999) * (1.0 - smoothstep(0.14, 0.38, lMax - lMin));
  if (sk > 0.002) {
    vec3 sMin = min(cM, min(min(cNW, cNE), min(cSW, cSE))), sMax = max(cM, max(max(cNW, cNE), max(cSW, cSE)));
    col = clamp(col + (col - 0.25 * (cNW + cNE + cSW + cSE)) * sk, sMin, sMax);
  }
  gl_FragColor = vec4(col, 1.0);
}`);
export const OUT_FS = `uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uRes; uniform float uNear; uniform float uFar; uniform float uTh; uniform float uOn; uniform vec4 uWL; uniform float uWLy[9]; uniform vec3 uUwC; uniform float uDrop; varying vec2 vUv;
float wlY(float x){ float f = clamp(x * 4.0 + 4.0, 0.0, 7.999); int i = int(f); float t = f - float(i); t = t * t * (3.0 - 2.0 * t); return mix(uWLy[i], uWLy[i + 1], t) + 0.035 * sin(x * 5.3 + uWL.x * 1.7) + 0.018 * sin(x * 13.7 - uWL.x * 2.9) + 0.008 * sin(x * 31.0 + uWL.x * 4.1); }   /* chop + ripples the CPU swell does not carry, same in sea + post so the cut matches */
float vz(vec2 uv){ float d = texture2D(tDepth, uv).x; float zn = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - zn * (uFar - uNear)); }
float dHash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.55); }
void main(){
  vec2 uv = vUv; float dropHi = 0.0;
  if (uDrop > 0.01) {   /* lens droplets for a moment after crossing the surface (Black Flag style): ~2 drops per cell, sliding down, each a tiny lens */
    vec2 asp = vec2(uRes.x / uRes.y, 1.0) * 4.0;
    for (int k = 0; k < 2; k++) {
      vec2 g = vUv * asp + vec2(float(k) * 0.37, float(k) * 0.61); vec2 id = floor(g); float h = dHash(id + float(k) * 7.1);
      if (h > 0.62) { float h2 = dHash(id + 3.3), h3 = dHash(id + 9.7), h4 = dHash(id + 17.1);
        vec2 f = fract(g) - vec2(0.25 + 0.5 * h2, 0.3 + 0.45 * h3 + (1.0 - uDrop) * (0.15 + 0.5 * h4)); float r = (0.05 + 0.16 * h4 * h4) * (0.6 + 0.4 * uDrop);
        float d = length(f * vec2(1.0, 0.8)); if (d < r) { float q = d / r; uv -= f / asp * (1.0 - q * q) * 2.2; dropHi = max(dropHi, (1.0 - smoothstep(0.6, 1.0, q)) * 0.25 + smoothstep(0.35, 0.0, length(f / r + vec2(0.35, -0.35))) * 0.8); } }
    }
  }
  vec4 c4 = texture2D(tColor, uv); vec3 c = c4.rgb; c += dropHi * 0.35 * uDrop;
  // alpha classes: >= 0.75 ordinary surfaces; 0.5 band = glowing lights (never inked); env-iter3: 0.25 = grass blades/flowers, 0.375 = park ground
  float lightMask = 1.0 - step(0.45, c4.a) * (1.0 - step(0.75, c4.a)) - (1.0 - step(0.75, c4.a)) * step(c4.a, 0.18);
  vec2 px = uTh / uRes;
  float z = vz(vUv);
  vec2 ox = vec2(px.x, 0.0), oy = vec2(0.0, px.y);
  float zx1 = vz(vUv + ox), zx2 = vz(vUv - ox), zy1 = vz(vUv + oy), zy2 = vz(vUv - oy);
  float e = max(max(zx1 - z, zx2 - z), max(zy1 - z, zy2 - z)) / z;   // one-sided: only the nearer pixel of a depth step is inked, so the line stays 1px and sits inside the near silhouette
  if (abs(c4.a - 0.25) < 0.06) {   // env-iter3 (Shifat: "grass blades must not get outline solo, whole grass lands get outline as one"): a blade pixel only inks against what is neither grass nor park ground, so blade-on-blade and blade-on-ground steps vanish and only the meadow's outer silhouette remains
    vec4 an = vec4(texture2D(tColor, vUv + ox).a, texture2D(tColor, vUv - ox).a, texture2D(tColor, vUv + oy).a, texture2D(tColor, vUv - oy).a);
    vec4 land = step(an, vec4(0.43)) * step(vec4(0.19), an);   // neighbour is grass (0.25) or ground (0.375)
    e = max(max((zx1 - z) * (1.0 - land.x), (zx2 - z) * (1.0 - land.y)), max((zy1 - z) * (1.0 - land.z), (zy2 - z) * (1.0 - land.w))) / z;
  }
  float k = smoothstep(0.12, 0.30, e) * (1.0 - smoothstep(22.0, 55.0, z)) * uOn * lightMask;
  c = mix(c, vec3(0.04, 0.05, 0.10), k * 0.85);
  if (uWL.w > 0.5) {   // Shifat Oct 31 12:27: half-in/half-out lens. Below the wave line the frame gets the same underwater look as diving (fog colour toward the line, teal light falloff below), with a thin meniscus on the line.
    vec2 sn = vUv * 2.0 - 1.0; float wd = sn.y - wlY(sn.x);
    float un = smoothstep(0.004, -0.004, wd);
    if (un > 0.0) {
      float below = clamp(-wd, 0.0, 2.0);
      // true underworld (the sea surface discards below the line): same linear fog as diving (55 -> 190 m) plus the dive light wash
      vec3 fogc = uUwC * vec3(0.85, 1.38, 1.18) * mix(1.2, 0.85, smoothstep(0.0, 1.6, below));
      vec3 cu = mix(c, c * vec3(0.55, 0.88, 0.95) + fogc * 0.18, 0.75);
      cu = mix(cu, fogc, smoothstep(12.0, 150.0, z));
      c = mix(c, cu, un);
    }
    float mn = 1.0 - smoothstep(0.0, 0.018, abs(wd));
    c = mix(c, uUwC * 0.45, mn * 0.55);
    c += vec3(0.10, 0.14, 0.15) * (1.0 - smoothstep(0.0, 0.035, abs(wd - 0.02))) * 0.6;
  }
  gl_FragColor = vec4(c, 1.0);
}`;

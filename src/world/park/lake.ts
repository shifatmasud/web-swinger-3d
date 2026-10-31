import * as THREE from 'three';
import { PARK_BRIDGE, bridgeSurfaceAt, parkH } from '../../sim';
import { CAUSTIC_GLSL } from '../../caustics';
import { WATER_COMMON_GLSL } from '../../water/common';

// Park lake: shoreline foam + bridge ramp geometry, and the lake / caustics / foam / contact shaders.
function subdividePositions(source: THREE.BufferGeometry, levels = 2) {
    const src = source.index ? source.toNonIndexed() : source;
    const attr = src.getAttribute('position');
    let triangles: number[][] = [];
    for (let i = 0; i < attr.count; i += 3) {
        triangles.push([
            attr.getX(i), attr.getY(i), attr.getZ(i),
            attr.getX(i + 1), attr.getY(i + 1), attr.getZ(i + 1),
            attr.getX(i + 2), attr.getY(i + 2), attr.getZ(i + 2),
        ]);
    }
    for (let level = 0; level < levels; level++) {
        const next: number[][] = [];
        const mid = (a: number[], b: number[]) => [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5];
        const push = (a: number[], b: number[], c: number[]) => next.push([...a, ...b, ...c]);
        for (const tri of triangles) {
            const a = tri.slice(0, 3), b = tri.slice(3, 6), c = tri.slice(6, 9);
            const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
            push(a, ab, ca); push(ab, b, bc); push(ca, bc, c); push(ab, bc, ca);
        }
        triangles = next;
    }
    const positions = new Float32Array(triangles.length * 9);
    triangles.forEach((tri, i) => positions.set(tri, i * 9));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    if (src !== source) src.dispose();
    return geometry;
}

export function shorelineFoamGeometry(rx: number, rz: number) {
    const segments = 240, positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
        const u = i / segments, a = u * Math.PI * 2;
        const jitter = 1 + 0.018 * Math.sin(a * 9 + 0.7) + 0.012 * Math.sin(a * 17 + 1.9);
        for (const edge of [-1, 1]) {
            const w = edge * (0.23 + 0.04 * Math.sin(a * 11));
            positions.push(Math.cos(a) * (rx * jitter + w), 0, Math.sin(a) * (rz * jitter + w));
            uvs.push(u, edge > 0 ? 1 : 0);
        }
        if (i < segments) {
            const k = i * 2;
            indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return geometry;
}

export function rampGeometry(sign: -1 | 1) {
    const segments = 12, positions: number[] = [], indices: number[] = [];
    const px = -PARK_BRIDGE.axisZ, pz = PARK_BRIDGE.axisX;
    for (let i = 0; i <= segments; i++) {
        const t = PARK_BRIDGE.halfLength + (PARK_BRIDGE.rampLength * i / segments);
        const along = sign * t;
        const x = PARK_BRIDGE.x + PARK_BRIDGE.axisX * along, z = PARK_BRIDGE.z + PARK_BRIDGE.axisZ * along;
        const leftX = x - px * 1.15, leftZ = z - pz * 1.15;
        const rightX = x + px * 1.15, rightZ = z + pz * 1.15;
        const bridgeY = bridgeSurfaceAt(x, z) ?? parkH(x, z);
        positions.push(leftX, bridgeY + 0.025, leftZ, rightX, bridgeY + 0.025, rightZ);
        if (i < segments) {
            const k = i * 2;
            indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return geometry;
}

// env-iter1 lake (Shifat's direction, Oct 29): hybrid reflections/refraction.
// - Hero: analytic ray trace of a 3-sphere proxy against the reflected and refracted view rays (no extra pass).
// - Everything else: short screen-space reflection march + one distorted screen-space refraction sample, read from a low-res
//   opaque scene copy (colour + depth) that is only re-rendered while the lake is on screen. Quarter-res / 7 steps on auto,
//   half-res / 16 steps on high, none on ?q=low or when the adaptive scaler is struggling (then: analytic sky reflection +
//   depth-based absorption with alpha so the real lakebed shows through).
// - Always: Schlick Fresnel with F0 = ((1.33-1)/(1.33+1))^2 ~ 0.02, refract(v, n, 1/1.33), animated ripple normals,
//   depth colour gradient, shoreline blend (transmission -> 1 as depth -> 0).
// Refs: three.js transmission pass approach; Morgan McGuire & Mara, "Efficient GPU Screen-Space Ray Tracing" (JCGT 2014);
//   Inigo Quilez sphere intersection; Schlick 1994.
export const LAKE_VS = `uniform float uTime; varying vec3 vWorld; varying vec3 vNormal; varying float vHeight; varying vec4 vScreen; varying vec3 vView;
void main(){vec4 w=modelMatrix*vec4(position,1.0);float a1=w.x*0.11+w.z*0.08+uTime*0.42,a2=w.x*0.21-w.z*0.16-uTime*0.31;float h=0.09*sin(a1)+0.035*sin(a2);
vec2 g=vec2(0.0099*cos(a1)+0.00735*cos(a2),0.0072*cos(a1)-0.0056*cos(a2));w.y+=h;vWorld=w.xyz;vHeight=h;vNormal=normalize(vec3(-g.x,1.0,-g.y));
vec4 mv=viewMatrix*w;vView=mv.xyz;vScreen=projectionMatrix*mv;gl_Position=vScreen;}`;
export const LAKE_FS = `#include <packing>
uniform float uTime; uniform sampler2D tScene; uniform sampler2D tDepth; uniform float uUseScene; uniform float uSteps; uniform float uNear; uniform float uFar;
uniform mat4 uProj; uniform vec2 uPondCenter; uniform float uPondR; uniform float uShore; uniform vec3 uHero; uniform vec3 uHor; uniform vec3 uZen; uniform vec3 uSun; uniform float uDay; uniform sampler2D uNrm; uniform vec4 uHeroA; uniform vec4 uHeroB; uniform sampler2D uSkyl;
${WATER_COMMON_GLSL}
varying vec3 vWorld; varying vec3 vNormal; varying float vHeight; varying vec4 vScreen; varying vec3 vView;
float sceneZ(vec2 uv){return perspectiveDepthToViewZ(texture2D(tDepth,uv).x,uNear,uFar);}
float sph(vec3 ro,vec3 rd,vec4 s){vec3 oc=ro-s.xyz;float b=dot(oc,rd);float h=b*b-dot(oc,oc)+s.w*s.w;if(h<0.0)return 1e5;float t=-b-sqrt(h);return t>0.0?t:1e5;}
float hero(vec3 ro,vec3 rd,out vec3 n){vec4 s0=vec4(uHero+vec3(0.0,0.1,0.0),0.36),s1=vec4(uHero+vec3(0.0,0.66,0.0),0.19),s2=vec4(uHero+vec3(0.0,-0.5,0.0),0.27);
float t0=sph(ro,rd,s0),t1=sph(ro,rd,s1),t2=sph(ro,rd,s2);float t=min(t0,min(t1,t2));vec4 s=t==t0?s0:(t==t1?s1:s2);n=normalize(ro+rd*t-s.xyz);return t;}
vec3 heroCol(vec3 n){return vec3(0.025,0.022,0.04)+vec3(0.10,0.09,0.16)*max(n.y,0.0)*uDay+vec3(0.18,0.10,0.32)*pow(1.0-abs(n.y),3.0)*0.35;}
vec3 sky(vec3 R){float h=max(R.y,0.0);vec3 c=mix(uHor,uZen,pow(h,0.5));c=mix(c,vec3(0.06,0.11,0.07)*(0.2+0.8*uDay),(1.0-smoothstep(0.02,0.16,h))*0.85);float s=max(dot(R,uSun),0.0);return c+vec3(1.0,0.88,0.66)*(pow(s,600.0)*3.5+pow(s,10.0)*0.12)*uDay;}
vec2 rip(vec2 p,vec2 d,float f,float sp,float a){float ph=dot(p,d)*f+uTime*sp;return d*(cos(ph)*a*f);}
void main(){
 vec3 V=normalize(cameraPosition-vWorld);bool below=!gl_FrontFacing;float dist=length(cameraPosition-vWorld);
 float rf=1.0-smoothstep(22.0,75.0,dist);vec2 p=vWorld.xz;
 vec2 g=rip(p,vec2(0.80,0.60),1.9,1.35,0.020)+rip(p,vec2(-0.55,0.83),2.7,-1.7,0.013)+rip(p,vec2(0.97,-0.24),4.3,2.3,0.006)+rip(p,vec2(-0.2,-0.98),6.1,-2.9,0.0035);
 g+=fftSlope(p,uTime)*WATER_FFT_K*(1.0-smoothstep(30.0,220.0,dist));/* same FFT ripple detail as the sea (src/water/common.ts) */
 vec3 N=normalize(vNormal+vec3(-g.x,0.0,-g.y)*rf);if(below)N=-N;
 float ci=clamp(dot(N,V),0.0,1.0);float F=0.02+0.98*pow(1.0-ci,5.0);
 vec3 R=reflect(-V,N);vec3 Td=refract(-V,N,below?1.33:1.0/1.33);
 float radial=length(vWorld.xz-uPondCenter)/uPondR;float bedDepth=3.25*(1.0-smoothstep(uShore-0.32,uShore,radial))+0.02*(1.0-smoothstep(uShore-0.04,uShore,radial));
 float shallow=1.0-smoothstep(0.15,2.2,bedDepth);
 vec2 suv=vScreen.xy/vScreen.w*0.5+0.5;float wz=vView.z;
 // reflection
 vec3 refl=sky(R);float reflDist=1e5;
  if(uUseScene>0.5&&!below){vec3 Rv=normalize((viewMatrix*vec4(R,0.0)).xyz);float tp=0.0;
  for(int i=0;i<16;i++){if(float(i)>=uSteps)break;float k=(float(i)+1.0)/uSteps;float t=90.0*k*k;vec3 Q=vView+Rv*t;vec4 c=uProj*vec4(Q,1.0);if(c.w<=0.0)break;vec2 uv=c.xy/c.w*0.5+0.5;
   if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0)break;float sz=sceneZ(uv);if(Q.z<sz&&Q.z>sz-(t-tp)*1.2-0.6&&sz>-uFar*0.98){
    if(uSteps>12.0){float a0=tp,a1=t;for(int j=0;j<4;j++){float m=0.5*(a0+a1);vec3 M=vView+Rv*m;vec4 cm=uProj*vec4(M,1.0);vec2 um=cm.xy/cm.w*0.5+0.5;if(M.z<sceneZ(um)){a1=m;uv=um;}else a0=m;}}
    float e=smoothstep(0.0,0.1,uv.x)*(1.0-smoothstep(0.9,1.0,uv.x))*(1.0-smoothstep(0.82,1.0,uv.y))*smoothstep(0.0,0.08,uv.y);vec2 bo=vec2(0.0035,0.0045)*(1.0+0.6*clamp(t/40.0,0.0,1.0));vec3 rs=(texture2D(tScene,uv).rgb*2.0+texture2D(tScene,uv+vec2(bo.x,0.0)).rgb+texture2D(tScene,uv-vec2(bo.x,0.0)).rgb+texture2D(tScene,uv+vec2(0.0,bo.y)).rgb+texture2D(tScene,uv-vec2(0.0,bo.y)).rgb)/6.0;/* soft 5-tap: the low-res scene copy no longer reads as pixel blocks, and blurs more for far objects like real ripple-roughened water */refl=mix(refl,reflTint(rs,refl),e*WATER_REFL_W);reflDist=t;break;}/* same soft blue subtle reflections as the sea */
   tp=t;}}
 if(!below&&reflDist>9e4){/* #5 pond reflection illusion v2 (Shifat 3:20 PM 'looks a bit wrong'): the bank trees are an analytic ring (cylinder) around the
   pond, hit by the per-pixel reflected ray, so the mirrored tree line hugs the shore with true parallax like a real pond; above the trees the far
   towers come from the projected ring (POND_SKYL_TEX). No renders, one fetch. */
  vec3 rr=normalize(mix(reflect(-V,vec3(0.0,1.0,0.0)),R,0.35));vec2 d2=rr.xz;float dl=max(length(d2),1e-3);d2/=dl;
  vec2 o2=vWorld.xz-uPondCenter;float Rb=uPondR*uShore+4.5;float b2=dot(o2,d2),c2=dot(o2,o2)-Rb*Rb;float th=-b2+sqrt(max(b2*b2-c2,0.0));
  vec2 hp=o2+d2*th;float az=atan(hp.x,hp.y);float hy=th*rr.y/dl;
  float tn=0.5+0.25*sin(az*7.0+1.3)+0.15*sin(az*17.0+0.4)+0.1*sin(az*41.0);float tH=4.0+5.0*tn;
  float pink=smoothstep(0.35,0.75,0.5+0.5*sin(az*5.0+0.7)+0.2*sin(az*23.0));
  vec3 treeC=mix(vec3(0.035,0.075,0.03),vec3(0.24,0.13,0.17),pink)*mix(0.25,1.0,uDay);vec3 bankC=vec3(0.06,0.08,0.035)*mix(0.25,1.0,uDay);
  float tc=1.0-smoothstep(tH-1.2,tH+0.6,hy+(N.x+N.z)*3.0);
  vec4 sk=texture2D(uSkyl,vec2(atan(rr.x,rr.z)*0.15915494+0.5,0.5));sk.rgb=pow(sk.rgb,vec3(2.2));
  float top=sk.a*0.35;float tw=step(0.004,sk.a)*(1.0-smoothstep(top*0.9,top*1.1+0.02,asin(clamp(rr.y,0.0,1.0))));
  vec3 rc=mix(refl,reflTint(sk.rgb*mix(0.3,0.9,uDay),refl),tw*0.7);rc=mix(rc,mix(bankC,treeC,smoothstep(0.4,1.4,hy)),tc*0.9);
  refl=rc;F=max(F,tc*0.55);}
 if(!below&&cameraPosition.y>vWorld.y){/* Shifat 6:06 PM: both heroes reflect in the pond (flying one too), same soft capsule style as the sea/pools/river; only the part above the surface */
  float wy=vWorld.y;bool nA=uHeroA.w>0.5&&length(uHeroA.xz-vWorld.xz)<40.0&&uHeroA.y+1.55>wy,nB=uHeroB.w>0.5&&length(uHeroB.xz-vWorld.xz)<40.0&&uHeroB.y+1.5>wy;
  float qA=nA?capHitP(vWorld,R,vec3(uHeroA.x,max(uHeroA.y+0.25,wy),uHeroA.z),uHeroA.xyz+vec3(0.0,1.55,0.0),0.34):-1.0,oA=nA&&qA<0.0?capHitP(vWorld,R,vec3(uHeroA.x,max(uHeroA.y+0.15,wy),uHeroA.z),uHeroA.xyz+vec3(0.0,1.7,0.0),0.55):-1.0;
  float qB=nB?capHitP(vWorld,R,vec3(uHeroB.x,max(uHeroB.y+0.25,wy),uHeroB.z),uHeroB.xyz+vec3(0.0,1.5,0.0),0.3):-1.0,oB=nB&&qB<0.0?capHitP(vWorld,R,vec3(uHeroB.x,max(uHeroB.y+0.15,wy),uHeroB.z),uHeroB.xyz+vec3(0.0,1.65,0.0),0.5):-1.0;
  float kA=heroSoftK(qA,oA),kB=heroSoftK(qB,oB);vec3 hc=vec3(0.0);float hk=0.0;
  if(kA>0.0&&kA>=kB){hk=kA;hc=vec3(0.09,0.11,0.21);}else if(kB>0.0){hk=kB;hc=vec3(0.78,0.82,0.92);}
  if(hk>0.0){refl=mix(refl,heroReflCol(hc,refl,uDay),heroReflW(hk,dist)*1.6);F=max(F,heroReflW(hk,dist)*0.5);}}
 // refraction / transmission
 vec3 deepCol=mix(vec3(0.010,0.07,0.13),vec3(0.03,0.20,0.22),shallow)*mix(0.25,1.0,uDay);vec3 absorb=vec3(0.46,0.12,0.075);/* same Beer-Lambert water as the sea (slightly richer), so the bed + caustics read through like the island shallows */
 vec3 trans;float alpha=1.0;
 if(uUseScene>0.5&&!below){float dd=max(wz-sceneZ(suv),0.0);vec3 Nv=(viewMatrix*vec4(N,0.0)).xyz;vec2 uv2=suv+Nv.xy*0.05*clamp(dd*0.5,0.0,1.0);
  float sz2=sceneZ(uv2);if(sz2>wz){uv2=suv;sz2=sceneZ(suv);}float th=clamp(wz-sz2,0.0,12.0)*1.15;vec3 T=exp(-absorb*th);
  vec3 behind=texture2D(tScene,uv2).rgb;vec3 hn2;float th2=1e5;/* #3: the real diving heroes draw through the water now (src/heroHD.ts), the analytic stand-in (Shifat 2:53 PM 'weird blue thingy') is off */if(th2<th+0.5&&(vWorld+Td*th2).y<vWorld.y)behind=mix(behind,heroCol(hn2),0.85);trans=behind*T+deepCol*(1.0-T);trans=trans*vec3(0.78,1.0,0.97)+vec3(0.0,0.025,0.03)*uDay;}/* clear-pond green-turquoise cast even in the shallows (was reading grey) */
 else{float th=bedDepth/max(abs(Td.y),0.25);vec3 T=exp(-absorb*th);float Ts=clamp(dot(T,vec3(0.2,0.4,0.4)),0.0,1.0);
  vec3 hn2;float th2=1e5;/* #3: the real diving heroes draw through the water now (src/heroHD.ts), the analytic stand-in (Shifat 2:53 PM 'weird blue thingy') is off */float hk=(th2<th+0.5&&(vWorld+Td*th2).y<vWorld.y)?0.85:0.0;/* only the submerged part refracts */trans=mix(deepCol*(1.0-T)/max(1.0-Ts,0.05),heroCol(hn2),hk);alpha=max(1.0-Ts*(1.0-hk),0.42);}/* keep the turquoise body tint when looking straight down (was going grey) */
 float f=below?max(F,0.12):F;vec3 col=mix(trans,refl,f);
 if(alpha<1.0){col=(refl*f+trans*(1.0-f)*alpha)/max(f+(1.0-f)*alpha,0.001);alpha=f+(1.0-f)*alpha;}
 if(below){float haze=1.0-exp(-dist*0.045);col=mix(col,vec3(0.035,0.23,0.30),haze*0.72);alpha=1.0;}
 col=mix(col,vec3(0.86,0.96,0.92),smoothstep(0.12,0.18,vHeight)*0.10);
 gl_FragColor=vec4(col,alpha);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
export const LAKE_CAUSTICS_VS = `varying vec2 vUv; varying vec3 vWorld; void main(){vUv=uv;vec4 w=modelMatrix*vec4(position,1.0);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`;
// Shifat 3:43 AM 'refracted caustic patterns are best, use them everywhere': the park pond's floor uses the SAME simulated caustic tile + causRGB as
// the sea (scale, speed, gain), lit only by day, and now visible from above too (it sits on the pond bed, so the lake's refraction copy carries it).
export const LAKE_CAUSTICS_FS = `uniform float uTime; uniform float uWaterY; uniform float uDayC; varying vec2 vUv; varying vec3 vWorld;
${CAUSTIC_GLSL}
void main(){vec3 k=causRGB(vWorld.xz*0.5,uTime*0.8)*2.6;float edge=1.0-smoothstep(0.68,1.0,length((vUv-0.5)*2.0));float dep=max(uWaterY-vWorld.y,0.0);
k=k*0.9/(1.0+k*0.9);/* soft-compressed like the lagoon: light lines, no white blotches */
gl_FragColor=vec4(k*edge*exp(-dep*0.10)*uDayC*0.55,1.0);}`;

export const FOAM_VS = `uniform float uTime; varying vec2 vUv; void main(){ vUv=uv; vec3 p=position; p.y+=0.016*sin(uv.x*35.0+uTime*1.3); gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0); }`;
// pond shore foam, same language as the island swash (Shifat 3:17 AM 'never tile'): caustic-cell lace (bombed along the ring), a soft run-up pulse
// that travels across the band at irregular moments, thinning outward - replaces the regular sine flecks that read as white smears.
export const FOAM_FS = `uniform float uTime; varying vec2 vUv;
${CAUSTIC_GLSL}
void main(){ float s = vUv.x * 92.0, li = floor(s * 0.031 + 0.5 + 0.5 * sin(s * 0.047)); vec2 q = vec2(s * 0.19, vUv.y * 1.3) + sin(vec2(4.1, 9.3) * li);
 float lace = texture2D(uCaus, q + vec2(uTime * 0.012, -uTime * 0.02)).r + 0.6 * texture2D(uCaus, q * 2.3 - uTime * 0.025).g;
 float ph = fract(uTime * 0.16 + 0.35 * sin(s * 0.11) + 0.2 * sin(s * 0.037)), run = smoothstep(0.0, 0.15, ph) * (1.0 - smoothstep(0.15, 0.9, ph));
 float band = 1.0 - smoothstep(0.15 + 0.45 * run, 0.95, vUv.y), edge = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.08, 0.3, vUv.y));
 float a = band * smoothstep(0.45, 0.9, lace * (0.55 + run)) * 0.8 + edge * (0.35 + 0.35 * run);
 gl_FragColor = vec4(vec3(0.93, 0.98, 0.96), clamp(a, 0.0, 0.9)); }`;
export const CONTACT_VS = `varying vec2 vUv; void main(){vUv=uv;vec4 w=modelMatrix*instanceMatrix*vec4(position,1.0);gl_Position=projectionMatrix*viewMatrix*w;}`;
export const CONTACT_FS = `uniform float uTime; varying vec2 vUv; void main(){float r=length(vUv-0.5);float ring=smoothstep(0.30,0.42,r)*(1.0-smoothstep(0.14,0.25,r));float wave=0.58+0.42*sin(atan(vUv.y-0.5,vUv.x-0.5)*17.0+uTime*2.2);float fleck=smoothstep(0.12,0.6,sin(vUv.x*71.0+vUv.y*39.0+uTime*1.7)*0.5+0.5);gl_FragColor=vec4(0.86,0.97,0.94,ring*wave*fleck*0.72);}`;


'use client';

/**
 * AuroraBackground — WebGL2 流动渐变动态背景（任务 P1-T7）
 *
 * 依据 DESIGN-SPEC.md：
 *  - 8.2 渲染管线：flowmap 累积（Pass A，离屏 FBO ping-pong）+ 渐变 / FBM 流体主渲染（Pass B），
 *    全屏三角带（TRIANGLE_STRIP, 4 顶点）；每帧上传 u_time = 秒 × (speed/100)、u_resolution、u_pixelRatio。
 *  - 8.5 性能策略：rAF 30 FPS 节流、DPR ≤ 1.5、IntersectionObserver(threshold:0) 离屏暂停、
 *    (hover:none),(pointer:coarse) 跳过鼠标监听、仅 resize 尺寸变化时重建、prefers-reduced-motion 静态帧。
 *  - 8.4 降级兜底：WebGL2 上下文创建失败 → 卸载 canvas，渲染三颗 CSS 光斑（#1A3870/#2D5F9E/#4A8AC4 + blur）。
 *  - 附录 11：三份 GLSL 逐字移植（导出为 AURORA_FLOWMAP/GRADIENT/FLUID_FRAGMENT_SHADER 常量，供测试）。
 *
 * ## Props（默认值见 AURORA_DEFAULTS，类型见 AuroraBackgroundProps）
 *  - type: 'gradient'（渐变主着色器 11.2）| 'fluid'（FBM 流体着色器 11.3），默认 'gradient'
 *  - colors: 渐变色板（hex），最多 5 色生效，不足自动以最后一色补齐；默认官方深蓝系 ['#2E58A4','#D2E2EE','#FFFFFF']
 *  - glowColors: 鼠标辉光三色（hex），默认纯白（官网 glow 默认白），可换品牌蓝
 *  - 数值 props（speed/scale/distortion/swirl/swirlIterations/mouseStrength/mouseRadius/decay/
 *    mouseSmoothing/mouseVelocity/distortBoost/noiseBoost/swirlBoost/glowIntensity）默认值见 AURORA_DEFAULTS
 *  - fluid 专属：grain/lightPos/lightCore/lightHalo/vignette/bloomThreshold/bloomRange/bloomStrength
 *  - gradient 专属：rotation/proportion/softness/shapeScale；两者共用：offset
 *  - className: 透传给 <canvas> / CSS 兜底容器
 *
 * ## 默认色板含义
 *  #2E58A4（深蓝）→ #D2E2EE（雾蓝）→ #FFFFFF（白）：DeepSeek Harness 官网 Hero 的「深蓝 → 雾蓝 → 白」氛围渐变；
 *  本站可替换为品牌色板，但背景仅作氛围层，深色页面下文字须满足 WCAG AA（主文字 #fff / 描述 ≥ 50% 白）。
 *
 * ## 在页面中的挂载用法（供 P1-T8 直接复制）
 *  ~~~tsx
 *  import AuroraBackground from '@/components/aurora-background';
 *
 *  <section className="relative flex items-center w-full ds-hero-height">
 *    // L1 z-0：WebGL 渐变层，模糊 + 底部渐隐遮罩（DESIGN-SPEC 8.1 遮罩公式，两处背景层共用）
 *    <div
 *      className="absolute inset-0 z-0 overflow-hidden"
 *      style={{
 *        mask: 'linear-gradient(#000000fc 0%, #000000e8 8.98%, transparent 100%)',
 *        filter: 'blur(20px)',
 *        opacity: 0, // 0→1 由 JS 淡入
 *      }}
 *    >
 *      <AuroraBackground />
 *    </div>
 *    <div className="relative z-10 ds-container ...">…hero 内容…</div>
 *  </section>
 *  ~~~
 *  注意：挂载容器必须是有定位的（absolute/relative），组件自身以 absolute inset-0 填满容器。
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

/* ------------------------------------------------------------------ *
 * 常量与着色器（附录 11 逐字移植）
 * ------------------------------------------------------------------ */

/** 渲染帧率上限（DESIGN-SPEC 8.5：30 FPS 节流） */
export const AURORA_FPS = 30;
/** 单帧最小间隔（ms） */
export const AURORA_FRAME_MS = 1000 / AURORA_FPS;
/** 像素比上限（DESIGN-SPEC 8.5：WebGL 1.5） */
export const AURORA_MAX_PIXEL_RATIO = 1.5;
/** WebGL2 上下文属性（DESIGN-SPEC 8.2） */
export const AURORA_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: false,
  powerPreference: 'low-power',
  antialias: false,
  depth: false,
  stencil: false,
};

/** 顶点着色器：全屏三角带，三程序共用（附录 11 开头） */
export const AURORA_VERTEX_SHADER = `
#version 300 es
in vec4 a_position;
out vec2 vUv;
void main() {
  vUv = a_position.xy * 0.5 + 0.5;
  gl_Position = a_position;
}
`;

/** 11.1 flowmap 累积着色器（Pass A：把鼠标影响写入离屏纹理） */
export const AURORA_FLOWMAP_FRAGMENT_SHADER = `
#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D u_prev;
uniform vec2 u_mouse;
uniform vec2 u_velocity;
uniform float u_brushRadius;
uniform float u_brushStrength;
uniform float u_decay;
out vec4 fragColor;

void main() {
  vec4 prev = texture(u_prev, vUv);

  prev.r *= u_decay;
  prev.gb = mix(vec2(0.5), prev.gb, u_decay);

  float dist = distance(vUv, u_mouse);

  float influence = exp(-dist * dist / (u_brushRadius * u_brushRadius * 0.5));
  influence = max(0.0, influence - 0.01);

  float speed = length(u_velocity);
  float presenceStrength = u_brushStrength * 0.3;
  float velBonus = min(speed * 3.0, 0.7) * u_brushStrength;
  float totalStrength = presenceStrength + velBonus;

  prev.r = max(prev.r, influence * totalStrength);
  float blendAmt = influence * min(totalStrength, 0.4) * 0.3;
  prev.g = mix(prev.g, clamp(u_velocity.x * 2.0 + 0.5, 0.0, 1.0), blendAmt);
  prev.b = mix(prev.b, clamp(u_velocity.y * 2.0 + 0.5, 0.0, 1.0), blendAmt);

  fragColor = prev;
}
`;

/** 11.2 渐变主着色器（Pass B，type:'gradient'：多色混合 + 噪声扭曲 + 漩涡 + 鼠标辉光） */
export const AURORA_GRADIENT_FRAGMENT_SHADER = `
#version 300 es
precision mediump float;
in vec2 vUv;
uniform float u_time;
uniform float u_pixelRatio;
uniform vec2 u_resolution;
uniform float u_scale;
uniform float u_rotation;
uniform vec4 u_color1, u_color2, u_color3, u_color4, u_color5;
uniform float u_colorCount;
uniform float u_proportion;
uniform float u_softness;
uniform float u_shape;
uniform float u_shapeScale;
uniform float u_distortion;
uniform float u_swirl;
uniform float u_swirlIterations;
uniform vec2 u_offset;
uniform sampler2D u_flowmap;
uniform float u_distortBoost;
uniform float u_noiseBoost;
uniform float u_swirlBoost;
uniform float u_glowIntensity;
uniform vec3 u_glowColor1;
uniform vec3 u_glowColor2;
uniform vec3 u_glowColor3;
out vec4 fragColor;

#define TWO_PI 6.28318530718
#define PI 3.14159265358979323846

vec2 rotate(vec2 uv, float th) { return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv; }
float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123); }
float noise(vec2 st) {
  vec2 i = floor(st); vec2 f = fract(st);
  float a = random(i), b = random(i + vec2(1,0)), c = random(i + vec2(0,1)), d = random(i + vec2(1,1));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}

vec3 blend_multi(float mixer, float softness) {
  float edge = 1.0 - softness;
  float n = u_colorCount;
  vec3 col = u_color1.rgb;
  if (n > 1.5) { col = mix(col, u_color2.rgb, smoothstep(0.0 + 0.2*edge, 1.0/(n-0.5) - 0.2*edge, mixer)); }
  if (n > 2.5) { col = mix(col, u_color3.rgb, smoothstep(1.0/(n-0.5) + 0.1*edge, 2.0/(n-0.5) - 0.1*edge, mixer)); }
  if (n > 3.5) { col = mix(col, u_color4.rgb, smoothstep(2.0/(n-0.5) + 0.1*edge, 3.0/(n-0.5) - 0.1*edge, mixer)); }
  if (n > 4.5) { col = mix(col, u_color5.rgb, smoothstep(3.0/(n-0.5) + 0.1*edge, 4.0/(n-0.5) - 0.1*edge, mixer)); }
  return col;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float t = .5 * u_time;
  float ns = .0005 + .006 * u_scale;
  uv -= .5; uv *= (ns * u_resolution); uv = rotate(uv, u_rotation * .5 * PI);
  uv /= u_pixelRatio; uv += .5; uv += u_offset;

  vec2 fragUV = gl_FragCoord.xy / u_resolution.xy;
  vec4 flow = texture(u_flowmap, fragUV);
  float influence = flow.r;
  vec2 flowDir = (flow.gb - 0.5) * 2.0;

  float n1 = noise(uv + t), n2 = noise(uv*2. - t);
  float angle = n1 * TWO_PI;

  float totalDistortion = u_distortion + influence * u_distortBoost;
  uv.x += 4. * totalDistortion * n2 * cos(angle);
  uv.y += 4. * totalDistortion * n2 * sin(angle);

  uv += flowDir * influence * 0.15;

  if (influence > 0.001) {
    float localNoise = noise(uv * 2.0 + t * 1.5);
    uv += influence * u_noiseBoost * vec2(cos(localNoise * TWO_PI), sin(localNoise * TWO_PI));
  }

  float iters = ceil(clamp(u_swirlIterations, 1., 30.));
  float swirlAmt = clamp(u_swirl, 0., 2.) + influence * u_swirlBoost;
  for (float i = 1.; i <= 30.0; i++) {
    if (i > iters) break;
    uv.x += swirlAmt / i * cos(t + i*1.5*uv.y);
    uv.y += swirlAmt / i * cos(t + i*1.*uv.x);
  }

  float proportion = clamp(u_proportion, 0., 1.);
  vec2 cuv = uv * (.5 + 3.5 * u_shapeScale);
  float shape = .5 + .5 * sin(cuv.x) * cos(cuv.y);
  float mixer = shape + .48 * sign(proportion - .5) * pow(abs(proportion - .5), .5);
  vec3 col = blend_multi(mixer, clamp(u_softness, 0., 1.));

  // Mouse proximity color shift: 3-color glow
  float glow = smoothstep(0.0, 0.8, influence);
  float glowNoise = noise(uv * 3.0 + u_time * 0.1) ;
  float glowDist = smoothstep(0.0, 1.0, influence);
  vec3 glowMix = mix(u_glowColor3, u_glowColor2, glowDist);
  glowMix = mix(glowMix, u_glowColor1, glowDist * glowNoise);
  col = mix(col, glowMix, glow * u_glowIntensity);

  fragColor = vec4(col, 1.0);
}
`;

/** 11.3 FBM 流体着色器（Pass B，type:'fluid'：3D simplex noise + 虚拟光源 + bloom + vignette + grain） */
export const AURORA_FLUID_FRAGMENT_SHADER = `
#version 300 es
precision mediump float;
in vec2 vUv;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec3 u_c1, u_c2, u_c3, u_c4, u_c5;
uniform float u_scale;
uniform vec2 u_offset;
uniform float u_grain;
uniform float u_speed;
uniform sampler2D u_flowmap;
uniform float u_distortBoost;
uniform float u_swirlBoost;
uniform float u_glowIntensity;
uniform vec3 u_glowColor1;
uniform vec3 u_glowColor2;
uniform vec3 u_glowColor3;
uniform vec2 u_lightPos;
uniform float u_lightCore;
uniform float u_lightHalo;
uniform float u_vignette;
uniform float u_bloomThreshold;
uniform float u_bloomRange;
uniform float u_bloomStrength;
out vec4 fragColor;

vec3 mod289v3(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289v4(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289v4(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}

float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);
  const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289v3(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.;
  vec4 s1=floor(b1)*2.+1.;
  vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);
  m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

float hash(vec2 p){
  vec3 p3=fract(vec3(p.xyx)*.1031);
  p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}

float fbm(vec3 p){
  float v=0.,amp=.6;vec3 shift=vec3(100.);
  for(int i=0;i<1;i++){v+=amp*snoise(p);p=p*2.+shift;amp*=.4;}
  return v;
}

float fluidNoise(vec2 uv,float t){
  float n1=fbm(vec3(uv*.6,t*.06));
  float n2=fbm(vec3(uv*.6+5.2,t*.06+1.3));
  vec2 w1=vec2(n1,n2)*.6;
  float n3=fbm(vec3((uv+w1)*.7+1.7,t*.05+3.1));
  float n4=fbm(vec3((uv+w1)*.7+9.2,t*.05+5.7));
  vec2 w2=vec2(n3,n4)*.5;
  return fbm(vec3((uv+w1+w2)*.5,t*.04));
}

vec2 curlish(vec2 uv,float t){
  float eps=.02;
  float n=snoise(vec3(uv*.8,t));
  float nx=snoise(vec3((uv+vec2(eps,0.))*.8,t));
  float ny=snoise(vec3((uv+vec2(0.,eps))*.8,t));
  return vec2(-(ny-n)/eps,(nx-n)/eps)*.003;
}

void main(){
  float aspect=u_resolution.x/u_resolution.y;
  vec2 uv=gl_FragCoord.xy/u_resolution;
  vec2 suv=vec2(uv.x*aspect, uv.y) * u_scale + u_offset;
  float t=u_time;

  // Mouse interaction via flowmap
  vec4 flow = texture(u_flowmap, uv);
  float influence = flow.r;
  vec2 flowDir = (flow.gb - 0.5) * 2.0;

  // Apply mouse distortion to UV
  suv += flowDir * influence * u_distortBoost * 0.8;
  // Apply mouse swirl
  float swirlAngle = influence * u_swirlBoost * 2.5;
  float cs = cos(swirlAngle), sn = sin(swirlAngle);
  vec2 delta = suv - vec2(uv.x * aspect, uv.y) * u_scale;
  suv += (mat2(cs, sn, -sn, cs) * delta - delta) * influence;

  vec2 curl=curlish(suv,t*.04);
  vec2 uvD=suv+curl*12.;
  float f=fluidNoise(uvD,t);
  float swirl=snoise(vec3(uvD*.8+f*1.5,t*.035))*.5+.5;
  float n=f*.5+.5;
  vec3 col=mix(u_c1,u_c2,smoothstep(.2,.5,n));
  col=mix(col,u_c3,smoothstep(.35,.65,n+swirl*.25));
  col=mix(col,u_c4,smoothstep(.6,.85,swirl)*.55);
  col=mix(col,u_c5,smoothstep(.5,.8,n*swirl)*.35);

  // Mouse proximity color shift: 3-color glow blended by distance + noise
  float glow = smoothstep(0.0, 0.8, influence);
  float glowNoise = snoise(vec3(uvD * 1.5, t * 0.08)) * 0.5 + 0.5;
  float glowDist = smoothstep(0.0, 1.0, influence);
  vec3 glowMix = mix(u_glowColor3, u_glowColor2, glowDist);
  glowMix = mix(glowMix, u_glowColor1, glowDist * glowNoise);
  col = mix(col, glowMix, glow * u_glowIntensity);

  if(u_grain>0.0){
    vec2 flowOffset = (uvD - suv) * u_resolution.y;
    vec2 gp = floor((gl_FragCoord.xy + flowOffset) / 5.0);
    float gr=hash(gp)*2.-1.;
    col+=gr*u_grain;
  }

  // Self-luminance bloom: bright fluid regions become their own light spots,
  // so glow follows the flow and mouse disturbance instead of a fixed point
  float luma=dot(col,vec3(.299,.587,.114));
  float bloom=smoothstep(u_bloomThreshold-u_bloomRange,u_bloomThreshold+u_bloomRange,luma);
  col+=(col*.85+vec3(.15,.145,.13))*bloom*u_bloomStrength;

  // Virtual light source: soft warm core (same side as helm lighting)
  float ld=length((uv-u_lightPos)*vec2(aspect,1.));
  float core=exp(-ld*ld*4.5);
  float halo=exp(-ld*1.8);
  col+=vec3(1.,.97,.9)*core*u_lightCore+vec3(.72,.8,1.)*halo*u_lightHalo;

  float vig=1.-smoothstep(.35,.75,length(uv-.5));
  col=mix(col*(1.-u_vignette),col,vig);
  fragColor=vec4(col,1.);
}
`;

/** flowmap 程序 uniform 名清单（供测试/工具使用） */
export const AURORA_FLOWMAP_UNIFORMS = [
  'u_prev',
  'u_mouse',
  'u_velocity',
  'u_brushRadius',
  'u_brushStrength',
  'u_decay',
] as const;

/** 渐变程序 uniform 名清单（供测试/工具使用） */
export const AURORA_GRADIENT_UNIFORMS = [
  'u_time',
  'u_pixelRatio',
  'u_resolution',
  'u_scale',
  'u_rotation',
  'u_color1',
  'u_color2',
  'u_color3',
  'u_color4',
  'u_color5',
  'u_colorCount',
  'u_proportion',
  'u_softness',
  'u_shape',
  'u_shapeScale',
  'u_distortion',
  'u_swirl',
  'u_swirlIterations',
  'u_offset',
  'u_flowmap',
  'u_distortBoost',
  'u_noiseBoost',
  'u_swirlBoost',
  'u_glowIntensity',
  'u_glowColor1',
  'u_glowColor2',
  'u_glowColor3',
] as const;

/** 流体程序 uniform 名清单（供测试/工具使用） */
export const AURORA_FLUID_UNIFORMS = [
  'u_time',
  'u_resolution',
  'u_c1',
  'u_c2',
  'u_c3',
  'u_c4',
  'u_c5',
  'u_scale',
  'u_offset',
  'u_grain',
  'u_speed',
  'u_flowmap',
  'u_distortBoost',
  'u_swirlBoost',
  'u_glowIntensity',
  'u_glowColor1',
  'u_glowColor2',
  'u_glowColor3',
  'u_lightPos',
  'u_lightCore',
  'u_lightHalo',
  'u_vignette',
  'u_bloomThreshold',
  'u_bloomRange',
  'u_bloomStrength',
] as const;

/** CSS 发光光斑兜底（DESIGN-SPEC 8.4「加入生态」段实测表） */
export const AURORA_FALLBACK_BLOBS: ReadonlyArray<CSSProperties> = [
  {
    bottom: -100,
    left: '10%',
    width: 500,
    height: 500,
    background: 'radial-gradient(circle, #1A3870 0%, transparent 70%)',
    filter: 'blur(80px)',
    opacity: 0.3,
  },
  {
    bottom: -50,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 700,
    height: 400,
    background: 'radial-gradient(ellipse at center, #2D5F9E 0%, #1A3870 40%, transparent 70%)',
    filter: 'blur(100px)',
    opacity: 0.4,
  },
  {
    bottom: -80,
    right: '10%',
    width: 400,
    height: 400,
    background: 'radial-gradient(circle, #4A8AC4 0%, #2D5F9E 30%, transparent 70%)',
    filter: 'blur(60px)',
    opacity: 0.2,
  },
];

/* ------------------------------------------------------------------ *
 * 类型与默认值（接口对齐 DESIGN-SPEC 8.6）
 * ------------------------------------------------------------------ */

/** 背景类型：'gradient' 渐变主着色器 / 'fluid' FBM 流体着色器 */
export type AuroraType = 'gradient' | 'fluid';

export interface AuroraBackgroundProps {
  /** 着色器类型，默认 'gradient' */
  type?: AuroraType;
  /** 渐变色板（hex），最多 5 色生效，不足自动以最后一色补齐；默认官方深蓝系 */
  colors?: string[];
  /** 鼠标辉光三色（hex）；默认纯白（官网 glow 默认白） */
  glowColors?: string[];
  /** 时间流速：u_time = 秒 × (speed/100)；100 = 实时 */
  speed?: number;
  /** 噪声尺度（gradient/fluid） */
  scale?: number;
  /** 基础扭曲（gradient） */
  distortion?: number;
  /** 漩涡强度（gradient，clamp 0..2） */
  swirl?: number;
  /** 漩涡迭代次数（gradient，1..30 clamp） */
  swirlIterations?: number;
  /** flowmap 刷子强度（0 可整体关闭鼠标影响） */
  mouseStrength?: number;
  /** flowmap 刷子半径（UV 0..1） */
  mouseRadius?: number;
  /** flowmap 每帧指数衰减（0..1，越小消失越快） */
  decay?: number;
  /** 鼠标指数平滑系数（0..1，官网参考 .08~.2） */
  mouseSmoothing?: number;
  /** 鼠标速度倍率（平滑速度 svx/svy 的缩放） */
  mouseVelocity?: number;
  /** 鼠标影响附加扭曲（gradient） */
  distortBoost?: number;
  /** 鼠标区噪声扰动（gradient） */
  noiseBoost?: number;
  /** 鼠标影响附加漩涡（gradient） */
  swirlBoost?: number;
  /** 鼠标辉光强度（0..1） */
  glowIntensity?: number;
  /** 色带比例（gradient，0..1） */
  proportion?: number;
  /** 色带软硬边（gradient，0..1） */
  softness?: number;
  /** 底层形状波缩放（gradient） */
  shapeScale?: number;
  /** 纹理偏移（gradient/fluid，UV） */
  offset?: [number, number];
  /** 旋转（gradient，弧度倍率） */
  rotation?: number;
  /** 胶片颗粒（fluid，0 关闭） */
  grain?: number;
  /** 虚拟光源位置（fluid，UV 0..1） */
  lightPos?: [number, number];
  /** 光源核心强度（fluid） */
  lightCore?: number;
  /** 光源光晕强度（fluid） */
  lightHalo?: number;
  /** 暗角强度（fluid，0..1） */
  vignette?: number;
  /** 自发光 bloom 阈值（fluid） */
  bloomThreshold?: number;
  /** 自发光 bloom 过渡范围（fluid） */
  bloomRange?: number;
  /** 自发光 bloom 强度（fluid） */
  bloomStrength?: number;
  /** 透传给 <canvas> / CSS 兜底容器的类名 */
  className?: string;
}

/** 全部 props 均已解析后的形态（className 除外） */
export type ResolvedAuroraProps = Required<Omit<AuroraBackgroundProps, 'className'>>;

/** 全部 props 默认值（DESIGN-SPEC 8.2 uniform 表 + 8.6 接口 + 官网参考值） */
export const AURORA_DEFAULTS: ResolvedAuroraProps = {
  type: 'gradient',
  colors: ['#2E58A4', '#D2E2EE', '#FFFFFF'],
  glowColors: ['#FFFFFF', '#FFFFFF', '#FFFFFF'],
  speed: 100,
  scale: 1,
  distortion: 0.12,
  swirl: 0.3,
  swirlIterations: 6,
  mouseStrength: 0.5,
  mouseRadius: 0.15,
  decay: 0.95,
  mouseSmoothing: 0.12,
  mouseVelocity: 1,
  distortBoost: 0.6,
  noiseBoost: 0.1,
  swirlBoost: 0.5,
  glowIntensity: 0.7,
  proportion: 0.5,
  softness: 0.35,
  shapeScale: 0.6,
  offset: [0, 0],
  rotation: 0,
  grain: 0.015,
  lightPos: [0.5, 0.32],
  lightCore: 0.22,
  lightHalo: 0.35,
  vignette: 0.35,
  bloomThreshold: 0.6,
  bloomRange: 0.25,
  bloomStrength: 0.4,
};

/* ------------------------------------------------------------------ *
 * 纯函数（导出供测试）
 * ------------------------------------------------------------------ */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * hex 颜色 → [r, g, b]（0..1）。支持 #RGB / #RRGGBB；非法输入回退白色 [1,1,1]。
 */
export function hexToRgb(hex: string): [number, number, number] {
  let h = (hex ?? '').trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [1, 1, 1];
  const n = parseInt(h, 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * 将色板归一化为固定长度的 [r,g,b] 数组：空色板回退默认色板；不足 pad 位以最后一色补齐。
 */
export function normalizeHexColors(
  colors: string[] | undefined,
  pad: number,
): [number, number, number][] {
  const src = colors && colors.length > 0 ? colors : AURORA_DEFAULTS.colors;
  const out: [number, number, number][] = [];
  for (let i = 0; i < pad; i++) {
    out.push(hexToRgb(src[Math.min(i, src.length - 1)]));
  }
  return out;
}

/**
 * 合并 props 与默认值：仅覆盖显式传入（非 undefined）的字段，保证 colors 等数组字段安全。
 */
export function mergeAuroraProps(props: AuroraBackgroundProps): ResolvedAuroraProps {
  const out: ResolvedAuroraProps = { ...AURORA_DEFAULTS };
  for (const key of Object.keys(props) as Array<keyof AuroraBackgroundProps>) {
    const value = props[key];
    if (value !== undefined) {
      (out as Record<keyof AuroraBackgroundProps, unknown>)[key] = value;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * WebGL2 内部工具
 * ------------------------------------------------------------------ */

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('[AuroraBackground] shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  // 固定 a_position 到 location 0（全屏三角带）
  gl.bindAttribLocation(program, 0, 'a_position');
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[AuroraBackground] program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

type UniformMap = Record<string, WebGLUniformLocation | null>;

function collectUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: readonly string[],
): UniformMap {
  const map: UniformMap = {};
  for (const name of names) {
    map[name] = gl.getUniformLocation(program, name);
  }
  return map;
}

/** 全屏三角带绘制（TRIANGLE_STRIP, 4 顶点），a_position 固定在 location 0 */
function drawFullscreen(gl: WebGL2RenderingContext, quadBuffer: WebGLBuffer): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

interface FlowFramebuffer {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
}

/** 创建一张离屏 FBO + RGBA8 纹理（CLAMP_TO_EDGE + LINEAR，供 flowmap ping-pong） */
function createFlowFramebuffer(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): FlowFramebuffer | null {
  const tex = gl.createTexture();
  const fb = gl.createFramebuffer();
  if (!tex || !fb) {
    if (tex) gl.deleteTexture(tex);
    if (fb) gl.deleteFramebuffer(fb);
    return null;
  }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) {
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fb);
    return null;
  }
  return { fb, tex };
}

/** 重建 flowmap 双缓冲，并清成中性态（r=0, gb=0.5） */
function buildFlowFramebuffers(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  prev: FlowFramebuffer[],
): FlowFramebuffer[] {
  for (const f of prev) {
    gl.deleteFramebuffer(f.fb);
    gl.deleteTexture(f.tex);
  }
  const a = createFlowFramebuffer(gl, width, height);
  const b = createFlowFramebuffer(gl, width, height);
  const out = a && b ? [a, b] : [];
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (out.length !== 2) {
    for (const f of out) {
      gl.deleteFramebuffer(f.fb);
      gl.deleteTexture(f.tex);
    }
    return [];
  }
  for (const f of out) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0.5, 0.5, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return out;
}

/* ------------------------------------------------------------------ *
 * 组件
 * ------------------------------------------------------------------ */

const CANVAS_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: 'block',
  pointerEvents: 'none',
};

const FALLBACK_STYLE: CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
};

function AuroraFallback({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={className} style={FALLBACK_STYLE}>
      {AURORA_FALLBACK_BLOBS.map((blob, i) => (
        <div key={i} style={{ position: 'absolute', ...blob }} />
      ))}
    </div>
  );
}

export function AuroraBackground(props: AuroraBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);

  // 每次渲染后同步最新合并后的 props，rAF 循环内通过 ref 读取（避免重建 WebGL 资源）。
  // 注意：不能直接在渲染期写 ref（react-hooks/refs），改在 effect 中同步。
  const resolved = mergeAuroraProps(props);
  const propsRef = useRef(resolved);
  const type = resolved.type;

  useEffect(() => {
    propsRef.current = resolved;
  }, [resolved]);

  useEffect(() => {
    // failed 后 canvas 已卸载，无需任何初始化
    if (failed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl2', AURORA_CONTEXT_ATTRIBUTES);
    } catch {
      gl = null;
    }
    if (!gl) {
      // 延迟到微任务再 setState，避开 react-hooks/set-state-in-effect（effect 内同步 setState）
      queueMicrotask(() => setFailed(true));
      return;
    }

    // ---- 编译三个程序（顶点共用） ----
    const flowProgram = createProgram(gl, AURORA_VERTEX_SHADER, AURORA_FLOWMAP_FRAGMENT_SHADER);
    const mainProgram = createProgram(
      gl,
      AURORA_VERTEX_SHADER,
      type === 'fluid' ? AURORA_FLUID_FRAGMENT_SHADER : AURORA_GRADIENT_FRAGMENT_SHADER,
    );
    if (!flowProgram || !mainProgram) {
      queueMicrotask(() => setFailed(true));
      return;
    }
    const flowUniforms = collectUniforms(gl, flowProgram, AURORA_FLOWMAP_UNIFORMS);
    const mainUniforms = collectUniforms(
      gl,
      mainProgram,
      type === 'fluid' ? AURORA_FLUID_UNIFORMS : AURORA_GRADIENT_UNIFORMS,
    );

    // ---- 全屏三角带顶点缓冲 ----
    const quadBuffer = gl.createBuffer();
    if (!quadBuffer) {
      queueMicrotask(() => setFailed(true));
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);

    // ---- uniform 上传辅助（主程序） ----
    const set1f = (name: string, v: number) => {
      const loc = mainUniforms[name];
      if (loc) gl.uniform1f(loc, v);
    };
    const set2f = (name: string, x: number, y: number) => {
      const loc = mainUniforms[name];
      if (loc) gl.uniform2f(loc, x, y);
    };
    const set3f = (name: string, r: number, g: number, b: number) => {
      const loc = mainUniforms[name];
      if (loc) gl.uniform3f(loc, r, g, b);
    };
    const set4f = (name: string, r: number, g: number, b: number, a: number) => {
      const loc = mainUniforms[name];
      if (loc) gl.uniform4f(loc, r, g, b, a);
    };
    const set1i = (name: string, v: number) => {
      const loc = mainUniforms[name];
      if (loc) gl.uniform1i(loc, v);
    };

    // ---- 鼠标状态（指数平滑 + 平滑速度） ----
    let targetX = 0.5;
    let targetY = 0.5;
    let smoothX = 0.5;
    let smoothY = 0.5;
    let prevSmoothX = 0.5;
    let prevSmoothY = 0.5;
    let svx = 0;
    let svy = 0;
    let rect: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 1, h: 1 };

    const onMouseMove = (e: MouseEvent) => {
      targetX = (e.clientX - rect.x) / rect.w;
      targetY = 1 - (e.clientY - rect.y) / rect.h;
    };

    const onContextLost = (e: Event) => {
      e.preventDefault();
      queueMicrotask(() => setFailed(true));
    };

    // ---- 尺寸 / 可见性 / 动效偏好 ----
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarsePointer = window.matchMedia('(hover: none), (pointer: coarse)').matches;
    // 触屏/降级动效时退化为纯自动动画：不注册鼠标监听，flowmap 刷子强度归零
    const interactive = !reducedMotion && !coarsePointer;

    let dpr = 1;
    let flowW = 0;
    let flowH = 0;
    let flowFramebuffers: FlowFramebuffer[] = [];

    const resize = () => {
      const cssW = Math.max(1, canvas.clientWidth || 1);
      const cssH = Math.max(1, canvas.clientHeight || 1);
      const nextDpr = Math.min(window.devicePixelRatio || 1, AURORA_MAX_PIXEL_RATIO);
      const nextW = Math.max(1, Math.round(cssW * nextDpr));
      const nextH = Math.max(1, Math.round(cssH * nextDpr));
      const bounds = canvas.getBoundingClientRect();
      rect = { x: bounds.x, y: bounds.y, w: Math.max(1, bounds.width), h: Math.max(1, bounds.height) };
      if (nextW === canvas.width && nextH === canvas.height) return; // 尺寸未变不重建
      dpr = nextDpr;
      canvas.width = nextW;
      canvas.height = nextH;
      gl.viewport(0, 0, nextW, nextH);
      const nextFlowW = Math.max(1, Math.floor(nextW / 2));
      const nextFlowH = Math.max(1, Math.floor(nextH / 2));
      if (nextFlowW !== flowW || nextFlowH !== flowH) {
        flowW = nextFlowW;
        flowH = nextFlowH;
        flowFramebuffers = buildFlowFramebuffers(gl, flowW, flowH, flowFramebuffers);
      }
    };

    // ---- 每帧渲染 ----
    let current = 0;
    const renderFrame = () => {
      const p = propsRef.current;

      // 指数平滑：原始坐标 → smoothX/Y（mouseSmoothing）→ 平滑速度 svx/svy（mouseVelocity）
      const smoothing = clamp01(p.mouseSmoothing);
      smoothX += (targetX - smoothX) * smoothing;
      smoothY += (targetY - smoothY) * smoothing;
      svx = (smoothX - prevSmoothX) * p.mouseVelocity;
      svy = (smoothY - prevSmoothY) * p.mouseVelocity;
      prevSmoothX = smoothX;
      prevSmoothY = smoothY;

      const brushStrength = interactive ? p.mouseStrength : 0;

      // Pass A：flowmap 累积写入离屏纹理（ping-pong）
      gl.bindFramebuffer(gl.FRAMEBUFFER, flowFramebuffers[current ^ 1].fb);
      gl.viewport(0, 0, flowW, flowH);
      gl.useProgram(flowProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, flowFramebuffers[current].tex);
      {
        const u = flowUniforms;
        const setFlow = (name: string, fn: (loc: WebGLUniformLocation | null) => void) => {
          const loc = u[name];
          if (loc) fn(loc);
        };
        setFlow('u_prev', (loc) => gl.uniform1i(loc, 0));
        setFlow('u_mouse', (loc) => gl.uniform2f(loc, smoothX, smoothY));
        setFlow('u_velocity', (loc) => gl.uniform2f(loc, svx, svy));
        setFlow('u_brushRadius', (loc) => gl.uniform1f(loc, p.mouseRadius));
        setFlow('u_brushStrength', (loc) => gl.uniform1f(loc, brushStrength));
        setFlow('u_decay', (loc) => gl.uniform1f(loc, p.decay));
      }
      drawFullscreen(gl, quadBuffer);
      current ^= 1;

      // Pass B：主渲染到屏幕
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(mainProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, flowFramebuffers[current].tex);

      const uTime = elapsed * (p.speed / 100);
      set1i('u_flowmap', 0);
      set2f('u_resolution', canvas.width, canvas.height);
      set1f('u_time', uTime);
      set1f('u_scale', p.scale);
      set2f('u_offset', p.offset[0], p.offset[1]);
      set1f('u_distortBoost', p.distortBoost);
      set1f('u_swirlBoost', p.swirlBoost);
      set1f('u_glowIntensity', p.glowIntensity);
      {
        const glow = normalizeHexColors(p.glowColors, 3);
        set3f('u_glowColor1', glow[0][0], glow[0][1], glow[0][2]);
        set3f('u_glowColor2', glow[1][0], glow[1][1], glow[1][2]);
        set3f('u_glowColor3', glow[2][0], glow[2][1], glow[2][2]);
      }

      if (type === 'fluid') {
        const cols = normalizeHexColors(p.colors, 5);
        set3f('u_c1', cols[0][0], cols[0][1], cols[0][2]);
        set3f('u_c2', cols[1][0], cols[1][1], cols[1][2]);
        set3f('u_c3', cols[2][0], cols[2][1], cols[2][2]);
        set3f('u_c4', cols[3][0], cols[3][1], cols[3][2]);
        set3f('u_c5', cols[4][0], cols[4][1], cols[4][2]);
        set1f('u_grain', p.grain);
        set1f('u_speed', p.speed / 100);
        set2f('u_lightPos', p.lightPos[0], p.lightPos[1]);
        set1f('u_lightCore', p.lightCore);
        set1f('u_lightHalo', p.lightHalo);
        set1f('u_vignette', p.vignette);
        set1f('u_bloomThreshold', p.bloomThreshold);
        set1f('u_bloomRange', p.bloomRange);
        set1f('u_bloomStrength', p.bloomStrength);
      } else {
        const cols = normalizeHexColors(p.colors, 5);
        set4f('u_color1', cols[0][0], cols[0][1], cols[0][2], 1);
        set4f('u_color2', cols[1][0], cols[1][1], cols[1][2], 1);
        set4f('u_color3', cols[2][0], cols[2][1], cols[2][2], 1);
        set4f('u_color4', cols[3][0], cols[3][1], cols[3][2], 1);
        set4f('u_color5', cols[4][0], cols[4][1], cols[4][2], 1);
        set1f(
          'u_colorCount',
          p.colors && p.colors.length > 0
            ? Math.min(p.colors.length, 5)
            : AURORA_DEFAULTS.colors.length,
        );
        set1f('u_pixelRatio', dpr);
        set1f('u_rotation', p.rotation);
        set1f('u_proportion', p.proportion);
        set1f('u_softness', p.softness);
        set1f('u_shape', 1);
        set1f('u_shapeScale', p.shapeScale);
        set1f('u_distortion', p.distortion);
        set1f('u_swirl', p.swirl);
        set1f('u_swirlIterations', p.swirlIterations);
        set1f('u_noiseBoost', p.noiseBoost);
      }

      drawFullscreen(gl, quadBuffer);
    };

    // ---- 首次尺寸与初始帧 ----
    resize();
    if (flowFramebuffers.length !== 2) {
      queueMicrotask(() => setFailed(true));
      return;
    }
    gl.clear(gl.COLOR_BUFFER_BIT);

    let elapsed = 0;
    let lastRenderNow = 0;
    let raf = 0;
    let lastFrame = 0;
    const visible = { v: true };

    const fail = (err?: unknown) => {
      if (err) console.error('[AuroraBackground] render error, falling back to CSS blobs:', err);
      if (raf !== 0) cancelAnimationFrame(raf);
      queueMicrotask(() => setFailed(true));
    };

    const renderOnce = () => {
      try {
        renderFrame();
      } catch (err) {
        fail(err);
      }
    };

    if (reducedMotion) {
      // prefers-reduced-motion：仅绘制一帧静态画面（u_time = 0），不推进时间、不注册鼠标
      renderOnce();
    } else {
      renderOnce(); // 首帧立即绘制，避免透明闪屏
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        if (!visible.v) {
          lastRenderNow = 0; // 离屏期间不计时，恢复后从当前帧续跑
          return;
        }
        if (now - lastFrame < AURORA_FRAME_MS) return; // 30 FPS 节流
        lastFrame = now;
        if (lastRenderNow !== 0) elapsed += (now - lastRenderNow) / 1000;
        lastRenderNow = now;
        try {
          renderFrame();
        } catch (err) {
          fail(err);
        }
      };
      raf = requestAnimationFrame(frame);
    }

    // 可见性：离屏暂停（IntersectionObserver, threshold 0）
    const io = new IntersectionObserver(
      (entries) => {
        visible.v = entries.some((e) => e.isIntersecting);
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    // 尺寸：ResizeObserver（canvas CSS 尺寸变化）+ window resize（覆盖 DPR 变化）
    const ro = new ResizeObserver(() => {
      resize();
    });
    ro.observe(canvas);
    const onWindowResize = () => {
      resize();
    };
    window.addEventListener('resize', onWindowResize);

    if (interactive) {
      window.addEventListener('mousemove', onMouseMove, { passive: true });
    }
    canvas.addEventListener('webglcontextlost', onContextLost);

    // ---- 卸载清理 ----
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener('resize', onWindowResize);
      window.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      if (gl) {
        for (const f of flowFramebuffers) {
          gl.deleteFramebuffer(f.fb);
          gl.deleteTexture(f.tex);
        }
        gl.deleteBuffer(quadBuffer);
        gl.deleteProgram(flowProgram);
        gl.deleteProgram(mainProgram);
        // StrictMode 模拟卸载不会摘除 DOM：仅当 canvas 已脱离文档（真正卸载）时才释放上下文，
        // 否则同一 canvas 重新挂载时 getContext 会因上下文已丢失而返回 null。
        if (!canvas.isConnected) {
          gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
      }
    };
    // type 参与程序选择；propsRef/setter/ref 均稳定，无需入依赖
  }, [failed, type]);

  if (failed) {
    return <AuroraFallback className={props.className} />;
  }

  return <canvas ref={canvasRef} aria-hidden="true" className={props.className} style={CANVAS_STYLE} />;
}

export default AuroraBackground;

<script setup lang="ts">
// Generative WebGL plasma backdrop for the hero (field.io "the page generates
// itself" moment). A full-screen fragment shader renders domain-warped fbm
// noise tinted violet -> cyan on near-black, reacting to cursor and scroll.
// Graceful fallbacks: static CSS gradient when WebGL is unavailable or the
// visitor prefers reduced motion; rAF pauses when the hero scrolls offscreen.
import { onMounted, onUnmounted, ref } from 'vue';

const canvas = ref<HTMLCanvasElement | null>(null);
const fallback = ref(false);

let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram | null = null;
let raf = 0;
let running = true;
let visible = true;
let startTime = 0;

const mouse = { x: 0.7, y: 0.25, tx: 0.7, ty: 0.25 };
let scrollN = 0;

let uRes: WebGLUniformLocation | null = null;
let uTime: WebGLUniformLocation | null = null;
let uMouse: WebGLUniformLocation | null = null;
let uScroll: WebGLUniformLocation | null = null;

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uScroll;

// value noise + fbm
float hash(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++){
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes.xy;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float t = uTime * 0.045 + uScroll * 0.6;

  // domain warp for flowing plasma
  vec2 q = vec2(fbm(p * 1.4 + t), fbm(p * 1.4 + vec2(5.2, 1.3) - t * 0.8));
  vec2 r = vec2(
    fbm(p * 1.4 + 1.2 * q + vec2(1.7, 9.2) + 0.15 * t),
    fbm(p * 1.4 + 1.2 * q + vec2(8.3, 2.8) - 0.126 * t)
  );
  float f = fbm(p * 1.4 + 1.6 * r);

  // cursor halo
  float md = distance(uv, uMouse);
  float halo = smoothstep(0.55, 0.0, md);

  vec3 violet = vec3(0.43, 0.36, 1.0);
  vec3 cyan   = vec3(0.13, 0.83, 0.93);
  vec3 col = mix(violet, cyan, clamp(f * 1.3 + r.x * 0.5, 0.0, 1.0));

  // shape the energy: concentrate into wisps
  float energy = pow(f, 1.9) * 2.4 + r.y * 0.16;
  col *= energy;
  // bright cores along the densest wisps (the "light traces")
  col += pow(max(f - 0.5, 0.0), 2.2) * 2.4 * mix(violet, cyan, clamp(r.x, 0.0, 1.0));
  col += halo * violet * 0.65;

  // brighter toward top, dissolve toward the fold so text stays readable
  float fade = smoothstep(-0.25, 1.02, uv.y);
  col *= mix(0.3, 1.14, fade);

  // warm near-black ground
  vec3 ground = vec3(0.031, 0.035, 0.039);
  col = ground + col;

  // subtle grain to kill banding
  float g = (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.02;
  col += g;

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(src: string, type: number): WebGLShader | null {
  if (!gl) return null;
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function resize() {
  const c = canvas.value;
  if (!c || !gl) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.floor(c.clientWidth * dpr);
  const h = Math.floor(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
    gl.viewport(0, 0, w, h);
  }
}

function frame(now: number) {
  if (!gl || !program) return;
  if (!startTime) startTime = now;
  if (running && visible) {
    resize();
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    scrollN = Math.min(1, (window.scrollY || 0) / 900);

    gl.uniform2f(uRes, canvas.value!.width, canvas.value!.height);
    gl.uniform1f(uTime, (now - startTime) / 1000);
    gl.uniform2f(uMouse, mouse.x, 1.0 - mouse.y);
    gl.uniform1f(uScroll, scrollN);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  raf = requestAnimationFrame(frame);
}

function onMove(e: MouseEvent) {
  mouse.tx = e.clientX / window.innerWidth;
  mouse.ty = e.clientY / window.innerHeight;
}

function init() {
  const reduced =
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const c = canvas.value;
  if (!c) {
    fallback.value = true;
    return;
  }
  gl =
    (c.getContext('webgl', { antialias: false, alpha: false }) as WebGLRenderingContext) ||
    (c.getContext('experimental-webgl') as WebGLRenderingContext);
  if (!gl) {
    fallback.value = true;
    return;
  }

  const vs = compile(VERT, gl.VERTEX_SHADER);
  const fs = compile(FRAG, gl.FRAGMENT_SHADER);
  if (!vs || !fs) {
    fallback.value = true;
    return;
  }
  program = gl.createProgram();
  if (!program) {
    fallback.value = true;
    return;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    fallback.value = true;
    return;
  }
  gl.useProgram(program);

  // full-screen triangle
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  uRes = gl.getUniformLocation(program, 'uRes');
  uTime = gl.getUniformLocation(program, 'uTime');
  uMouse = gl.getUniformLocation(program, 'uMouse');
  uScroll = gl.getUniformLocation(program, 'uScroll');

  resize();

  if (reduced) {
    // render a single static frame, then stop
    gl.uniform2f(uRes, c.width, c.height);
    gl.uniform1f(uTime, 12.0);
    gl.uniform2f(uMouse, 0.7, 0.75);
    gl.uniform1f(uScroll, 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return;
  }

  // pause when hero scrolls offscreen
  const io = new IntersectionObserver(
    (entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    },
    { threshold: 0 },
  );
  io.observe(c);

  window.addEventListener('mousemove', onMove, { passive: true });
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
  });

  raf = requestAnimationFrame(frame);
}

function cleanup() {
  cancelAnimationFrame(raf);
  window.removeEventListener('mousemove', onMove);
  window.removeEventListener('resize', resize);
}

onMounted(init);
onUnmounted(cleanup);
</script>

<template>
  <div class="hero-canvas-wrap" aria-hidden="true">
    <canvas ref="canvas" class="hero-canvas" :class="{ 'is-hidden': fallback }" />
    <div v-if="fallback" class="hero-canvas-fallback" />
    <div class="hero-canvas-veil" />
  </div>
</template>

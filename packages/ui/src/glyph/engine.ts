export type Rgb = readonly [number, number, number];

export interface Print {
  readonly ground: Rgb;
  readonly keyLo: Rgb;
  readonly keyHi: Rgb;
  readonly plate: Rgb;
  readonly paper: boolean;
}

export interface StageOptions {
  readonly glsl: string;
  readonly view: number;
  readonly print: Print;
  readonly cell: number;
  readonly loop: number;
  readonly dpr?: number;
}

export interface Stage {
  readonly cols: number;
  readonly rows: number;
  setLight: (x: number, y: number) => void;
  render: (t: number) => void;
  sync: () => void;
  renderer: () => string;
}

const VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0., 1.); }`;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
`;

const PRELUDE = `${COMMON}
uniform vec2 uCells;
uniform float uUnit, uT, uLoop, uPaper;
uniform vec2 uLight;
out vec4 oCol;
const float PI = 3.14159265, TAU = 6.28318531;
vec2 R(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c*v.x - s*v.y, s*v.x + c*v.y); }
float smin(float a, float b, float k){ float h = clamp(.5 + .5*(b - a)/k, 0., 1.); return mix(b, a, h) - k*h*(1. - h); }
float smax(float a, float b, float k){ return -smin(-a, -b, k); }
float sdSph(vec3 p, float r){ return length(p) - r; }
float sdEll(vec3 p, vec3 r){ float k0 = length(p/r); float k1 = length(p/(r*r)); return k0*(k0 - 1.)/k1; }
float sdEllB(vec3 p, vec3 r){ return (length(p/r) - 1.)*min(r.x, min(r.y, r.z)); }
float sdCap(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba)/dot(ba, ba), 0., 1.); return length(pa - ba*h) - r; }
float sdCone(vec3 p, vec3 a, vec3 b, float ra, float rb){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba)/dot(ba, ba), 0., 1.); return length(pa - ba*h) - mix(ra, rb, h); }
float PH(){ return TAU*fract(uT/uLoop); }
float h3(vec3 p){ p = fract(p*.3183099 + .1); p *= 17.; return fract(p.x*p.y*p.z*(p.x + p.y + p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3. - 2.*f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

const SCENE_MAIN = `
vec3 nrm(vec3 p){
  vec2 e = vec2(1., -1.)*.004; vec3 t;
  return normalize(e.xyy*map(p + e.xyy, t) + e.yyx*map(p + e.yyx, t) + e.yxy*map(p + e.yxy, t) + e.xxx*map(p + e.xxx, t));
}
void main(){
  vec2 w = (gl_FragCoord.xy - uCells*.5)*uUnit;
  vec3 ro = vec3(w, -3.), p = ro, m = vec3(0.);
  float t = 0.;
  bool hit = false;
  for (int i = 0; i < 72; i++){
    p = ro + vec3(0., 0., t);
    float d = map(p, m);
    if (d < .002){ hit = true; break; }
    t += d*.85;
    if (t > 6.) break;
  }
  if (!hit){ oCol = vec4(0.); return; }
  vec3 tmp, n = nrm(p);
  map(p, m);
  vec3 L = normalize(vec3(uLight, -1.1));
  vec3 H = normalize(L + vec3(0., 0., -1.));
  float ao = clamp(map(p + n*.12, tmp)/.12, 0., 1.);
  float diff = max(0., dot(n, L));
  float bounce = .18*max(0., -n.y);
  float spec = pow(max(0., dot(n, H)), 36.);
  float fres = pow(1. - max(0., -n.z), 2.5);
  float kind = m.x, tone = m.y;
  float fadeK = 0.;
  if (kind > 2.5){ fadeK = m.z; m.z = 0.; kind = 0.; }
  float s = clamp(.32 + bounce + .75*diff*(.5 + .5*ao), 0., 1.);
  float A = 1. - tone;
  float grain = (.45*vnoise(p*55.) + .55*vnoise(vec3(p.x*70., p.y*200., p.z*70.)) - .5)*.26;
  float amt;
  if (kind > 1.5 && kind < 2.5){
    amt = uPaper > .5 ? tone : tone*.55;
    oCol = vec4(amt*(1. - m.z), 0., 0., 1.);
    return;
  }
  if (kind > .5){
    float gl = smoothstep(.55, .9, spec + .35*diff*diff*diff);
    amt = uPaper > .5 ? 1. - gl : .04 + .9*gl;
    oCol = vec4(amt, 0., 1., 1.);
    return;
  }
  amt = uPaper > .5
    ? clamp(A*(1.3 - .6*s) + (1. - s)*.22 + fres*.3*(1. - ao*.3) + grain, 0., .68)
    : clamp(tone*(.3 + .95*s) + fres*.22*s + .04 - grain*.8, 0., 1.);
  float plate = m.z*clamp(.08 + .3*s, 0., .34)*(uPaper > .5 ? 1. : .7);
  oCol = vec4(amt*(1. - fadeK), plate, .5*tone, 1.);
}
`;

const COMP_SRC = `${COMMON}
uniform sampler2D uScene;
uniform vec2 uCells;
uniform float uCell, uDpr, uPaper;
uniform vec3 uGround, uKeyLo, uKeyHi, uPlate;
out vec4 oCol;
const float B[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
float bayer(ivec2 q){ return (B[(q.x & 3) + ((q.y & 3) << 2)] + .5)/16.; }

vec4 cellAt(vec2 p){
  ivec2 c = ivec2(floor(p/uCell));
  if (c.x < 0 || c.y < 0 || c.x >= int(uCells.x) || c.y >= int(uCells.y)) return vec4(0.);
  return texelFetch(uScene, c, 0);
}

float mark(float a, vec2 p){
  vec2 cf = floor(p/uCell);
  vec2 l = p - (cf + .5)*uCell;
  if (a < .03) return 0.;
  if (a < .25) return a > bayer(ivec2(floor(p*uDpr/2.))) ? 1. : 0.;
  if (a < .7){
    float rad = uCell*.56*sqrt(a);
    return clamp((rad - length(l))*uDpr + .5, 0., 1.);
  }
  float q = max(1., floor(a*5. + .5))/5.;
  float hf = uCell*.5*sqrt(min(a, q)) - .1;
  float d = length(max(abs(l) - hf, 0.)) - .3;
  return clamp(.5 - d*uDpr, 0., 1.);
}

void main(){
  vec2 p = gl_FragCoord.xy/uDpr;
  vec4 s = cellAt(p);
  vec2 po = p - vec2(1., -1.);
  vec4 so = cellAt(po);
  float pc = 0.;
  if (so.a > .5 && so.g > .01){
    vec2 cf = floor(po/uCell);
    vec2 l = po - (cf + .5)*uCell;
    float rad = uCell*.58*sqrt(so.g);
    pc = clamp((rad - length(l))*uDpr + .5, 0., 1.);
  }
  vec3 col = uGround;
  if (uPaper > .5) col *= mix(vec3(1.), uPlate/max(uGround, vec3(.01)), pc*.9);
  else col = mix(col, uPlate, pc*.8);
  if (s.a > .5){
    float a = s.r;
    float k = mark(a, p);
    vec3 key = mix(uKeyLo, uKeyHi, smoothstep(.45, 1.3, a));
    if (s.b > .9) key = uKeyHi;
    col = mix(col, key, k);
  }
  oCol = vec4(clamp(col, 0., 1.), 1.);
}`;

const compile = (
  gl: WebGL2RenderingContext,
  type: GLenum,
  src: string
): WebGLShader => {
  const s = gl.createShader(type);

  if (!s) {
    throw new Error("createShader failed");
  }

  gl.shaderSource(s, src);
  gl.compileShader(s);

  if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    return s;
  }

  const numbered = src
    .split("\n")
    .map((line, i) => `${i + 1}: ${line}`)
    .join("\n");

  throw new Error(`${gl.getShaderInfoLog(s) ?? "compile failed"}\n${numbered}`);
};

interface Program {
  readonly program: WebGLProgram;
  readonly uniforms: (name: string) => WebGLUniformLocation | null;
}

const program = (gl: WebGL2RenderingContext, frag: string): Program => {
  const pr = gl.createProgram();
  gl.attachShader(pr, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(pr, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(pr, 0, "aPos");
  gl.linkProgram(pr);

  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(pr) ?? "link failed");
  }

  const cache = new Map<string, WebGLUniformLocation | null>();

  return {
    program: pr,
    uniforms: (name) => {
      if (!cache.has(name)) {
        cache.set(name, gl.getUniformLocation(pr, name));
      }

      return cache.get(name) ?? null;
    },
  };
};

const unit = (c: Rgb): [number, number, number] => [
  c[0] / 255,
  c[1] / 255,
  c[2] / 255,
];

export const createStage = (
  canvas: HTMLCanvasElement,
  o: StageOptions
): Stage => {
  const dpr = o.dpr ?? Math.min(globalThis.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 600;
  const cssH = canvas.clientHeight || cssW;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true,
  });

  if (!gl) {
    throw new Error("webgl2 unavailable");
  }

  const cols = Math.ceil(cssW / o.cell);
  const rows = Math.ceil(cssH / o.cell);
  const light: [number, number] = [-0.5, 0.62];
  const paper = o.print.paper ? 1 : 0;

  gl.bindVertexArray(gl.createVertexArray());
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const scene = program(gl, PRELUDE + o.glsl + SCENE_MAIN);
  const comp = program(gl, COMP_SRC);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    cols,
    rows,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    tex,
    0
  );

  return {
    cols,
    render(t) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, cols, rows);
      gl.useProgram(scene.program);
      const u = scene.uniforms;
      gl.uniform2f(u("uCells"), cols, rows);
      gl.uniform1f(u("uUnit"), o.view / rows);
      gl.uniform1f(u("uT"), t);
      gl.uniform1f(u("uLoop"), o.loop);
      gl.uniform1f(u("uPaper"), paper);
      gl.uniform2f(u("uLight"), light[0], light[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(comp.program);
      const c = comp.uniforms;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(c("uScene"), 0);
      gl.uniform2f(c("uCells"), cols, rows);
      gl.uniform1f(c("uCell"), o.cell);
      gl.uniform1f(c("uDpr"), dpr);
      gl.uniform1f(c("uPaper"), paper);
      gl.uniform3f(c("uGround"), ...unit(o.print.ground));
      gl.uniform3f(c("uKeyLo"), ...unit(o.print.keyLo));
      gl.uniform3f(c("uKeyHi"), ...unit(o.print.keyHi));
      gl.uniform3f(c("uPlate"), ...unit(o.print.plate));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    renderer() {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");

      return String(
        ext
          ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER)
      );
    },
    rows,
    setLight(x, y) {
      light[0] = x;
      light[1] = y;
    },
    sync() {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    },
  };
};

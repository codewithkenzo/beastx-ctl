import type { Print, Rgb } from "./engine";

export type Pose = "awake" | "asleep";

export const LOOP = 8;
const VIEW = 2.6;
const FRAME = { scale: 1, x: 0.47, y: 0.42 };

const common = `
void pick(inout float best, float d, vec3 mm, inout vec3 m){ if (d < best){ best = d; m = mm; } }
float chain(vec3 q, vec3 a, vec3 b, vec3 c, float r0, float r1){
  float d = 1e3; vec3 prev = a;
  for (int i = 1; i <= 14; i++){
    float u = float(i)/14.;
    vec3 cur = mix(mix(a, b, u), mix(b, c, u), u);
    d = smin(d, sdCap(q, prev, cur, mix(r0, r1, u)), .02);
    prev = cur;
  }
  return d;
}
float branch(vec3 q, inout vec3 m, float res){
  vec3 bq = q;
  bq.y += .03*sin(q.x*2.3 + .4);
  float b = sdCone(bq, vec3(-1.5, -.72, .12), vec3(1.5, -.44, .12), .085, .045);
  float tw = sdCone(q, vec3(.72, -.53, .12), vec3(1.05, -.18, .02), .034, .016);
  b = smin(b, tw, .03);
  float knot = sdEll(q - vec3(-.55, -.65, .05), vec3(.05, .05, .05));
  b = smin(b, knot, .04);
  float fade = smoothstep(.55, 1.35, abs(q.x - .05));
  float bark = .38 + .18*vnoise(vec3(q.x*6., q.y*40., q.z*40.));
  pick(res, b, vec3(3., bark, fade), m);
  vec3 lq = q - vec3(1.02, .1, -.02);
  lq.xy = R(lq.xy, -.55);
  float ves = max(length(lq.xy - vec2(.17, 0.)) - .32, length(lq.xy + vec2(.17, 0.)) - .32);
  ves = smax(ves, abs(lq.y) - .3, .02);
  float leaf = max(ves, abs(lq.z) - .012);
  float rib = smoothstep(.016, .0, abs(lq.x)) + .6*smoothstep(.012, .0, abs(fract(lq.y*7. - abs(lq.x)*5.) - .5)*.14);
  pick(res, leaf, vec3(3., .8 - .35*clamp(rib, 0., 1.), 0.), m);
  return res;
}
float dormHead(vec3 hq, float eyeOpen, float white, out vec3 mh, out float hard){
  float head = sdEll(hq, vec3(.23, .2, .2));
  float snout = sdCone(hq, vec3(.04, -.03, 0.), vec3(.24, -.07, 0.), .14, .07);
  head = smin(head, snout, .08);
  float throat = white*smoothstep(-.06, -.15, hq.y - .2*hq.x);
  mh = vec3(0., mix(.5, .95, throat), .95*(1. - throat));
  vec3 e1 = hq - vec3(-.08, .16, -.06);
  e1.xy = R(e1.xy, .45);
  float ear = sdEllB(e1, vec3(.075, .08, .028));
  float ear2 = sdEllB(hq - vec3(-.02, .17, .12), vec3(.07, .075, .028));
  float ears = min(ear, ear2);
  if (ears < head) mh = vec3(0., .58, .6);
  vec3 eq = hq - vec3(.1, .045, -.15);
  float eye = eyeOpen > .5 ? sdSph(eq, .062) : sdEllB(eq, vec3(.07, .016, .045));
  hard = min(eye, sdSph(hq - vec3(.29, -.075, 0.), .03));
  return smin(head, ears, .02);
}
`;

const awake = `
float sub(vec3 q, out vec3 m){
  float ph = PH();
  q.yz = R(q.yz, .15);
  q.xz = R(q.xz, .3);
  m = vec3(0., .5, 0.);
  float res = branch(q, m, 1e3);
  float bd = length(q - vec3(-.1, -.2, 0.)) - 1.3;
  if (bd > res) return res;
  float br = 1. + .014*sin(ph);
  vec3 bq = q - vec3(.02, -.12, 0.);
  bq.xy = R(bq.xy, -.25);
  float body = sdEll(bq, vec3(.3, .36, .3)*br);
  float hip = sdEll(q - vec3(-.12, -.32, .02), vec3(.36, .27, .32));
  body = smin(body, hip, .14);
  float throat = smoothstep(.08, .2, q.x - .12 + .3*(q.y + .1))*smoothstep(-.4, -.2, q.y);
  vec3 mb = vec3(0., mix(.48, .92, throat), .95*(1. - throat));
  vec3 hq = q - vec3(.2, .3, -.03);
  hq.xy = R(hq.xy, -.2 + .04*sin(ph + .5));
  vec3 mh; float hard;
  float head = dormHead(hq, 1., 1., mh, hard);
  float d = smin(body, head, .1);
  vec3 mm = head < body ? mh : mb;
  pick(res, d, mm, m);
  float nut = sdEll(q - vec3(.38, .02, -.2), vec3(.09, .1, .09));
  pick(res, nut, vec3(0., .5, .25), m);
  float paws = min(sdCap(q, vec3(.22, -.02, -.22), vec3(.33, -.04, -.27), .036), sdCap(q, vec3(.22, .0, .05), vec3(.36, -.03, -.1), .033));
  pick(res, paws, vec3(0., .82, 0.), m);
  float feet = min(sdEllB(q - vec3(.12, -.6, -.2), vec3(.12, .045, .06)), sdEllB(q - vec3(.06, -.6, .2), vec3(.11, .045, .06)));
  pick(res, feet, vec3(0., .66, 0.), m);
  float tail = chain(q, vec3(-.36, -.35, .1), vec3(-.62, -.95, .25), vec3(-.42, -1.25, -.05), .085, .065);
  tail += .012*vnoise(q*38.);
  pick(res, tail, vec3(0., .46, .95), m);
  pick(res, hard, vec3(1., 0., 0.), m);
  return res;
}
`;

const asleep = `
float sub(vec3 q, out vec3 m){
  float ph = PH();
  q.yz = R(q.yz, .15);
  q.xz = R(q.xz, .3);
  m = vec3(0., .5, 0.);
  float res = branch(q, m, 1e3);
  float bd = length(q - vec3(0., -.2, 0.)) - 1.1;
  if (bd > res) return res;
  float br = 1. + .025*sin(ph);
  float body = sdEll(q - vec3(-.02, -.26, .02), vec3(.4, .36*br, .37));
  vec3 mb = vec3(0., .48, .95);
  vec3 hq = q - vec3(.3, -.2, -.18);
  hq.xy = R(hq.xy, .85);
  vec3 mh; float hard;
  float head = dormHead(hq, 0., 0., mh, hard);
  float d = smin(body, head, .1);
  vec3 mm = head < body ? mh : mb;
  pick(res, d, mm, m);
  float tail = chain(q, vec3(-.36, -.45, .12), vec3(-.3, .42, -.38), vec3(.42, .02, -.42), .085, .075);
  tail += .03*vnoise(q*26.);
  pick(res, tail, vec3(0., .16, .45), m);
  pick(res, hard, vec3(1., 0., 0.), m);
  return res;
}
`;

const byte = (hex: string, at: number): number =>
  Number.parseInt(hex.trim().slice(at, at + 2), 16);

const toRgb = (hex: string): Rgb => [byte(hex, 1), byte(hex, 3), byte(hex, 5)];

const mix = (a: Rgb, b: Rgb, t: number): Rgb => {
  const at = (i: 0 | 1 | 2) => Math.round(a[i] + (b[i] - a[i]) * t);

  return [at(0), at(1), at(2)];
};

export const dormouseGlsl = (pose: Pose): string => {
  const cx = ((FRAME.x - 0.5) * VIEW).toFixed(4);
  const cy = ((0.5 - FRAME.y) * VIEW).toFixed(4);
  const s = FRAME.scale.toFixed(4);

  return `${common}${pose === "awake" ? awake : asleep}
float map(vec3 p, out vec3 m){
  vec3 q = (p - vec3(${cx}, ${cy}, 0.))/${s};
  return sub(q, m)*${s};
}`;
};

export const dormouseView = VIEW;

export interface PrintColours {
  ground: string;
  ink: string;
  muted: string;
  plate: string;
}

export const printFrom = (c: PrintColours, paper: boolean): Print => {
  const ground = toRgb(c.ground);
  const ink = toRgb(c.ink);

  return {
    ground,
    keyHi: ink,
    keyLo: paper ? mix(ink, toRgb(c.muted), 0.5) : mix(ink, ground, 0.42),
    paper,
    plate: toRgb(c.plate),
  };
};

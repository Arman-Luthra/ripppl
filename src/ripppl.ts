import domtoimage from "dom-to-image-more";
import html2canvas from "html2canvas";

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  const u = 1 - t;
  return [u * a[0] + t * b[0], u * a[1] + t * b[1], u * a[2] + t * b[2]];
}

function saturateRgb(
  rgb: [number, number, number],
  amt: number
): [number, number, number] {
  const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return [
    clamp01(rgb[0] + (rgb[0] - y) * amt),
    clamp01(rgb[1] + (rgb[1] - y) * amt),
    clamp01(rgb[2] + (rgb[2] - y) * amt),
  ];
}

type GlowPalette = {
  dodge: [number, number, number];
  screen: [number, number, number];
  mix: [number, number, number];
};

function parseHueToken(tok: string): number {
  const t = tok.trim().toLowerCase();
  if (t.endsWith("deg")) return parseFloat(t.slice(0, -3));
  if (t.endsWith("rad")) return (parseFloat(t.slice(0, -3)) * 180) / Math.PI;
  if (t.endsWith("turn")) return parseFloat(t.slice(0, -4)) * 360;
  if (t.endsWith("grad")) return (parseFloat(t.slice(0, -4)) * 360) / 400;
  return parseFloat(t);
}

function parseOklchComponents(
  s: string
): { l: number; c: number; h: number } | null {
  const t = s.trim();
  if (!/^oklch\s*\(/i.test(t)) return null;
  const inner = t.slice(t.indexOf("(") + 1, t.lastIndexOf(")"));
  const main = inner.split(/\s*\/\s*/)[0].trim();
  const tokens = main.split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return null;
  let l: number;
  if (tokens[0].endsWith("%")) {
    l = Math.min(1, Math.max(0, parseFloat(tokens[0]) / 100));
  } else {
    l = Math.min(1, Math.max(0, parseFloat(tokens[0])));
  }
  let c: number;
  if (tokens[1].endsWith("%")) {
    c = Math.max(0, (parseFloat(tokens[1]) * 0.4) / 100);
  } else {
    c = Math.max(0, parseFloat(tokens[1]));
  }
  const h = parseHueToken(tokens[2]);
  if (!Number.isFinite(l) || !Number.isFinite(c) || !Number.isFinite(h))
    return null;
  return { l, c, h };
}

function oklabToLrgb(l: number, a: number, b: number): [number, number, number] {
  const L = Math.pow(l + 0.3963377773761749 * a + 0.2158037573099136 * b, 3);
  const M = Math.pow(l - 0.1055613458156586 * a - 0.0638541728258133 * b, 3);
  const S = Math.pow(l - 0.0894841775298119 * a - 1.2914855480194092 * b, 3);
  return [
    4.0767416360759574 * L - 3.3077115392580616 * M + 0.2309699031821044 * S,
    -1.2684379732850317 * L + 2.6097573492876887 * M - 0.3413193760026573 * S,
    -0.0041960761386756 * L - 0.7034186179359362 * M + 1.7076146940746117 * S,
  ];
}

function lrgbChannelToSrgb(c: number): number {
  const abs = Math.abs(c);
  if (abs > 0.0031308) {
    return (Math.sign(c) || 1) * (1.055 * Math.pow(abs, 1 / 2.4) - 0.055);
  }
  return c * 12.92;
}

export type RippleTuning = {
  amplitude?: number;
  frequency?: number;
  speed?: number;
  damping?: number;
  decay?: number;
  duration?: number;
  chromatic?: boolean;
  chromaticIntensity?: number;
  shimmer?: string | false;
  shimmerWidth?: number;
  shimmerDuration?: number;
  shimmerGlowColor?: string;
};

export type RippleOptions = RippleTuning & {
  scope?: string | HTMLElement;
  exclude?: boolean | TriggerInput;
};

export const RIPPPL_CAPTURE_IGNORE_ATTR = "data-ripppl-overlay";

function parseOklchToLinearRgb(css: string): [number, number, number] {
  const o = parseOklchComponents(css);
  if (!o) return [1, 1, 1];
  const hr = (o.h / 180) * Math.PI;
  const a = o.c ? o.c * Math.cos(hr) : 0;
  const b = o.c ? o.c * Math.sin(hr) : 0;
  const [lr, lg, lb] = oklabToLrgb(o.l, a, b);
  return [
    clamp01(lrgbChannelToSrgb(lr)),
    clamp01(lrgbChannelToSrgb(lg)),
    clamp01(lrgbChannelToSrgb(lb)),
  ];
}

export type RippleHandle = {
  destroy: () => void;
  update: (opts: Partial<RippleTuning>) => void;
  invalidateCapture: () => void;
  prefetchCapture: () => void;
  trigger: (opts?: {
    x?: number;
    y?: number;
    fromElement?: HTMLElement;
  }) => void;
};

type TriggerInput =
  | string
  | HTMLElement
  | NodeListOf<HTMLElement>
  | HTMLElement[];

type Ripple = { cx: number; cy: number; t0: number };

function resolveTriggers(input: TriggerInput): HTMLElement[] {
  if (typeof input === "string")
    return Array.from(document.querySelectorAll<HTMLElement>(input));
  if (input instanceof HTMLElement) return [input];
  return Array.from(input);
}

function resolveScope(scope: string | HTMLElement | undefined): HTMLElement {
  if (!scope) return document.body;
  if (typeof scope === "string")
    return document.querySelector<HTMLElement>(scope) ?? document.body;
  return scope;
}

function parseBorderRadiusMinPx(el: HTMLElement): number {
  const raw = getComputedStyle(el).borderRadius || "0";
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 0;
  const rect = el.getBoundingClientRect();
  let minR = Infinity;
  for (const p of parts) {
    if (p.endsWith("%")) {
      const r = (parseFloat(p) / 100) * Math.min(rect.width, rect.height);
      if (Number.isFinite(r)) minR = Math.min(minR, r);
    } else {
      const px = parseFloat(p);
      if (Number.isFinite(px)) minR = Math.min(minR, px);
    }
  }
  return minR === Infinity ? 0 : minR;
}

function ancestorClipsOverflow(el: HTMLElement): boolean {
  const cs = getComputedStyle(el);
  const o = cs.overflow;
  const ox = cs.overflowX;
  const oy = cs.overflowY;
  return (
    o === "hidden" ||
    o === "clip" ||
    ox === "hidden" ||
    ox === "clip" ||
    oy === "hidden" ||
    oy === "clip"
  );
}

function effectiveExcludeRadiusPx(el: HTMLElement, scopeEl: HTMLElement): number {
  let r = parseBorderRadiusMinPx(el);
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== scopeEl) {
    if (ancestorClipsOverflow(node)) {
      r = Math.max(r, parseBorderRadiusMinPx(node));
    }
    node = node.parentElement;
  }
  return r;
}

function parseCssRgbToVec3(css: string): [number, number, number] {
  const s = css.trim();
  let m = s.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i
  );
  if (!m) {
    m = s.match(
      /^rgba?\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+%?)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i
    );
  }
  if (m) {
    const parseCh = (x: string) =>
      x.endsWith("%") ? (parseFloat(x) / 100) * 255 : parseFloat(x);
    const r = parseCh(m[1]) / 255;
    const g = parseCh(m[2]) / 255;
    const b = parseCh(m[3]) / 255;
    const a =
      m[4] !== undefined
        ? m[4].endsWith("%")
          ? parseFloat(m[4]) / 100
          : parseFloat(m[4])
        : 1;
    if (a >= 0.999) return [clamp01(r), clamp01(g), clamp01(b)];
    return [
      clamp01(r * a + 0.08 * (1 - a)),
      clamp01(g * a + 0.08 * (1 - a)),
      clamp01(b * a + 0.08 * (1 - a)),
    ];
  }
  if (s.startsWith("#") && (s.length === 4 || s.length === 7)) {
    const hex =
      s.length === 4
        ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
        : s;
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  return [0.1, 0.1, 0.12];
}

function resolveExcludeList(
  exclude: boolean | TriggerInput | undefined,
  triggers: HTMLElement[]
): HTMLElement[] {
  if (exclude === undefined || exclude === false) return [];
  const raw =
    exclude === true ? triggers : resolveTriggers(exclude as TriggerInput);
  const seen = new Set<HTMLElement>();
  const out: HTMLElement[] = [];
  for (const el of raw) {
    if (!seen.has(el)) {
      seen.add(el);
      out.push(el);
    }
  }
  return out;
}

function cssColorIsTransparent(bg: string): boolean {
  const s = bg.trim().toLowerCase();
  if (s === "transparent") return true;
  const m = s.match(
    /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/
  );
  if (m) return parseFloat(m[1]) < 0.5;
  return false;
}

function resolveSolidBackground(el: HTMLElement): string {
  let node: HTMLElement | null = el;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    if (!cssColorIsTransparent(bg)) return bg;
    node = node.parentElement;
  }
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  if (!cssColorIsTransparent(bodyBg)) return bodyBg;
  return "#1a1a24";
}

function samplePixel(
  img: HTMLImageElement,
  pctx: CanvasRenderingContext2D,
  px: number,
  py: number
): string | undefined {
  const x = Math.max(0, Math.min(Math.floor(px), img.naturalWidth - 1));
  const y = Math.max(0, Math.min(Math.floor(py), img.naturalHeight - 1));
  pctx.clearRect(0, 0, 1, 1);
  pctx.drawImage(img, x, y, 1, 1, 0, 0, 1, 1);
  const d = pctx.getImageData(0, 0, 1, 1).data;
  if (d[3] > 12) return `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
  return undefined;
}

function sampleFillFromCrop(
  img: HTMLImageElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  scopeEl: HTMLElement,
  radiusPx?: number
): string {
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const pctx = probe.getContext("2d")!;
  const pts: [number, number][] = [];
  if (radiusPx !== undefined && radiusPx > 0.5) {
    const rr = Math.min(radiusPx, Math.min(sw, sh) * 0.5 - 1);
    if (rr > 1) {
      pts.push(
        [sx + rr, sy + rr],
        [sx + sw - rr, sy + rr],
        [sx + rr, sy + sh - rr],
        [sx + sw - rr, sy + sh - rr]
      );
    }
  }
  pts.push(
    [sx + sw * 0.5, sy + sh - 2],
    [sx + sw * 0.5, sy + 2],
    [sx + 1, sy + sh - 2],
    [sx + sw - 2, sy + sh - 2],
    [sx + 1, sy + 1],
    [sx + sw - 2, sy + 1],
    [sx + sw * 0.5, sy + sh * 0.5]
  );
  for (const [px, py] of pts) {
    const c = samplePixel(img, pctx, px, py);
    if (c) return c;
  }
  return resolveSolidBackground(scopeEl);
}

const VERT = `attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform vec2 u_css;
uniform float u_time;
uniform int u_count;
uniform vec3 u_rip[16];
uniform float u_freq, u_speed, u_amp, u_damp, u_decay;
uniform float u_chroma;
uniform vec3 u_shimColor;
uniform float u_shimStr;
uniform float u_shimWidth;
uniform float u_shimIntScale;
uniform float u_shimDur;
uniform vec3 u_glowDodge;
uniform vec3 u_glowScreen;
uniform vec3 u_glowMix;
uniform int u_exclCount;
uniform vec4 u_excl[16];
uniform float u_exclRad[16];
uniform float u_scopeClip;
uniform float u_scopeRad;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
}

vec3 texRgb(vec2 tuv) {
  vec4 c = texture2D(u_tex, tuv);
  return c.rgb / max(c.a, 0.0001);
}

void main(){
  vec2 uv_frag = gl_FragCoord.xy / u_res;
  vec2 uv = vec2(uv_frag.x, 1.0 - uv_frag.y);
  if (u_scopeClip > 0.5) {
    vec2 sizePx = u_css;
    vec2 pTl = uv * u_css;
    vec2 p = pTl - sizePx * 0.5;
    float r = min(u_scopeRad, min(sizePx.x, sizePx.y) * 0.5);
    float d = sdRoundBox(p, sizePx * 0.5, r);
    if (d > 0.0) {
      gl_FragColor = vec4(texRgb(uv), 1.0);
      return;
    }
  }
  if (u_exclCount > 0) {
    for (int j = 0; j < 16; j++) {
      if (j >= u_exclCount) break;
      vec4 b = u_excl[j];
      if (uv.x < b.x || uv.x > b.x + b.z || uv.y < b.y || uv.y > b.y + b.w) continue;
      vec2 sizePx = b.zw * u_css;
      vec2 pTl = uv * u_css - b.xy * u_css;
      vec2 p = pTl - sizePx * 0.5;
      float r = min(u_exclRad[j], min(sizePx.x, sizePx.y) * 0.5);
      float d = sdRoundBox(p, sizePx * 0.5, r);
      if (d <= 0.0) {
        gl_FragColor = vec4(texRgb(uv), 1.0);
        return;
      }
    }
  }
  vec2 d = vec2(0.0);
  float maxShim = 0.0;
  float maxDodge = 0.0;
  float maxScreen = 0.0;
  float maxOuter = 0.0;
  for(int i = 0; i < 16; i++){
    if(i >= u_count) break;
    vec2 c = u_rip[i].xy;
    float t = u_time - u_rip[i].z;
    vec2 diff = (uv - c) * u_css;
    float dist = length(diff);
    if(dist < 0.5) continue;

    float front = t * u_speed;
    float behind = front - dist;
    float mask = smoothstep(0.0, 2.0, behind);
    float ringDecay = exp(-behind * u_damp);
    float temporal = exp(-t * u_decay);
    float phase = dist * u_freq - t * u_speed * u_freq;
    float wave = sin(phase) * mask * ringDecay * temporal;
    float center = smoothstep(0.0, 10.0, dist);

    d -= normalize(diff) * wave * u_amp * center;

    float b = max(0.0, behind);
    float delayT = clamp((t - 0.05) / 0.32, 0.0, 1.0);
    float delay = (1.0 - pow(1.0 - delayT, 3.0)) * step(0.05, t);
    float growT = clamp(t / 3.9, 0.0, 1.0);
    float easeOut = 1.0 - pow(1.0 - growT, 3.0);
    float radialScale = clamp(1.0 + front * 0.0032 + front * front * 8.0e-7, 1.0, 5.0);
    float sigma = mix(32.0, 142.0, easeOut) * radialScale * u_shimWidth;
    float peak = mix(18.0, 72.0, easeOut) * radialScale * u_shimWidth;
    float x = (b - peak) / max(sigma, 1.0);
    float x2 = x * x;
    float shimBell =
      exp(-x2) * 0.68 + exp(-x2 * 0.52) * 0.32;
    float tailW = mix(0.12, 0.075, easeOut) / (1.0 + t * 1.15 + front * 0.0012);
    float shimTail = exp(-b * tailW);
    float enterW = mix(10.0, 36.0, easeOut) * radialScale * u_shimWidth;
    float shimEnter = smoothstep(0.0, enterW, b);
    float fadeT = clamp(t / max(u_shimDur, 0.001), 0.0, 1.0);
    float opacityEase = 1.0 - pow(fadeT, 2.35);
    float opacityFade = opacityEase * delay * exp(-t * 0.72);
    float shimEdge =
      shimEnter * shimBell * shimTail * opacityFade * center * u_shimIntScale;
    maxShim = max(maxShim, shimEdge);
    float gBase = shimEnter * shimTail * opacityFade * center;
    float su = max(sigma, 1.0);
    float u = (b - peak) / su;
    float ao = (u + 0.78) / 0.48;
    float gOut = exp(-(ao * ao));
    float am = (u + 0.22) / 0.26;
    float gMid = exp(-(am * am));
    float ac = u / 0.1;
    float gHot = exp(-(ac * ac));
    float mOuter =
      max(0.0, gOut - gMid * 0.75 - gHot * 0.15) * gBase * u_shimIntScale;
    float mScreen =
      max(0.0, gMid - gHot * 0.82 - gOut * 0.35) * gBase * u_shimIntScale;
    float mDodge = max(0.0, gHot - gMid * 0.45) * gBase * u_shimIntScale;
    maxDodge = max(maxDodge, mDodge);
    maxScreen = max(maxScreen, mScreen);
    maxOuter = max(maxOuter, mOuter);
  }
  d /= u_css;

  vec3 col;
  if(u_chroma > 0.0){
    vec2 spread = d * u_chroma;
    vec2 perp = vec2(-spread.y, spread.x) * 0.5;

    float r = 0.0, g = 0.0, b = 0.0;
    float tw = 0.0;
    for(int s = -3; s <= 3; s++){
      float f = float(s) / 3.0;
      float w = exp(-2.0 * f * f);
      tw += w;
      vec2 rOff = spread * (f - 1.0) + perp * f;
      vec2 gOff = perp * f * 0.3;
      vec2 bOff = spread * (f + 1.0) - perp * f;
      vec2 st = uv + vec2(d.x, d.y);
      r += texRgb(st + vec2(rOff.x, rOff.y)).r * w;
      g += texRgb(st + vec2(gOff.x, gOff.y)).g * w;
      b += texRgb(st + vec2(bOff.x, bOff.y)).b * w;
    }
    col = vec3(r, g, b) / tw;
  } else {
    col = texRgb(uv + vec2(d.x, d.y));
  }
  if(u_shimStr > 0.0){
    float di = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
    float n = (di - 0.5) * 0.012;
    float coreAmt = clamp(maxShim * u_shimStr + n, 0.0, 1.0);
    float edge = 1.0 - coreAmt * 0.18;
    float o = clamp(maxOuter * u_shimStr + n, 0.0, 1.0) * edge;
    float s = clamp(maxScreen * u_shimStr + n, 0.0, 1.0) * edge;
    col = mix(col, u_glowMix, o * 0.92);
    vec3 scr = u_glowScreen * s * 1.02;
    scr = min(scr, vec3(0.97));
    col = vec3(1.0) - (vec3(1.0) - col) * (vec3(1.0) - scr);
    col = min(col, vec3(1.0));
    col = mix(col, u_shimColor, coreAmt);
    float dg = clamp(maxDodge * u_shimStr + n, 0.0, 1.0);
    float hot = dg * (0.62 + 0.38 * (1.0 - coreAmt));
    vec3 cs = u_glowDodge * hot * 2.05;
    cs = clamp(cs, vec3(0.0), vec3(0.995));
    vec3 denom = vec3(1.0) - cs;
    denom = max(denom, vec3(0.001));
    col = min(col / denom, vec3(1.0));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export function attachRipple(
  trigger: TriggerInput,
  options: RippleOptions = {}
): RippleHandle {
  const triggers = resolveTriggers(trigger);
  const scopeEl = resolveScope(options.scope);
  const isBody = scopeEl === document.body;
  const excludeEls = resolveExcludeList(options.exclude, triggers);
  const overlayZ = excludeEls.length > 0 ? 2147483646 : 2147483647;

  const scopeRect = () => {
    if (isBody) {
      return { left: 0, top: 0, width: innerWidth, height: innerHeight };
    }
    const rect = scopeEl.getBoundingClientRect();
    const cs = getComputedStyle(scopeEl);
    const bl = parseFloat(cs.borderLeftWidth) || 0;
    const bt = parseFloat(cs.borderTopWidth) || 0;
    return {
      left: rect.left + bl,
      top: rect.top + bt,
      width: scopeEl.clientWidth,
      height: scopeEl.clientHeight,
    };
  };

  let amp = options.amplitude ?? 3.0;
  let freq = options.frequency ?? 0.018;
  let speed = options.speed ?? 300.0;
  let damp = options.damping ?? 0.025;
  let decay = options.decay ?? 1.2;
  let duration = (options.duration ?? 3500) / 1000;
  let chromatic = options.chromatic ?? false;
  let chromaticIntensity = options.chromaticIntensity ?? 0.4;
  let shimColor: [number, number, number] = options.shimmer
    ? parseOklchToLinearRgb(options.shimmer)
    : [1, 1, 1];
  let shimStr = options.shimmer ? 1.0 : 0.0;
  let shimWidth = options.shimmerWidth ?? 1;
  let shimDur = (options.shimmerDuration ?? 2600) / 1000;
  let glowOklch: string | undefined = options.shimmerGlowColor;
  const computeGlowPalette = (): GlowPalette => {
    if (!shimStr) {
      return {
        dodge: [1, 1, 1],
        screen: [1, 1, 1],
        mix: [1, 1, 1],
      };
    }
    const base = glowOklch ? parseOklchToLinearRgb(glowOklch) : shimColor;
    return {
      dodge: mixRgb(base, [1, 1, 1], 0.94),
      screen: saturateRgb(base, 1.72),
      mix: mixRgb(saturateRgb(base, 0.45), [1, 1, 1], 0.4),
    };
  };
  let glowPalette = computeGlowPalette();

  const overlay = document.createElement("canvas");
  overlay.setAttribute(RIPPPL_CAPTURE_IGNORE_ATTR, "");
  if (isBody) {
    overlay.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:${overlayZ};`;
  } else {
    const pos = getComputedStyle(scopeEl).position;
    if (pos === "static") scopeEl.style.position = "relative";
    const cs = getComputedStyle(scopeEl);
    overlay.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:${overlayZ};`;
    overlay.style.borderRadius = cs.borderRadius;
    overlay.style.overflow = "hidden";
  }
  if (isBody) {
    document.body.appendChild(overlay);
  } else {
    scopeEl.appendChild(overlay);
  }

  const gl = overlay.getContext("webgl", {
    premultipliedAlpha: false,
    alpha: true,
    antialias: true,
  })!;
  if (!gl) {
    overlay.remove();
    return {
      destroy() {},
      update() {},
      invalidateCapture() {},
      prefetchCapture() {},
      trigger() {},
    };
  }

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };

  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );
  const aPos = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const loc = (n: string) => gl.getUniformLocation(prog, n);
  const uRes = loc("u_res");
  const uCss = loc("u_css");
  const uTime = loc("u_time");
  const uCount = loc("u_count");
  const uFreq = loc("u_freq");
  const uSpeed = loc("u_speed");
  const uAmp = loc("u_amp");
  const uDamp = loc("u_damp");
  const uDecay = loc("u_decay");
  const uChroma = loc("u_chroma");
  const uShimColor = loc("u_shimColor");
  const uShimStr = loc("u_shimStr");
  const uShimWidth = loc("u_shimWidth");
  const uShimIntScale = loc("u_shimIntScale");
  const uShimDur = loc("u_shimDur");
  const uGlowDodge = loc("u_glowDodge");
  const uGlowScreen = loc("u_glowScreen");
  const uGlowMix = loc("u_glowMix");
  const uExclCount = loc("u_exclCount");
  const uExcl: (WebGLUniformLocation | null)[] = [];
  for (let i = 0; i < 16; i++) uExcl.push(loc(`u_excl[${i}]`));
  const uExclRad: (WebGLUniformLocation | null)[] = [];
  for (let i = 0; i < 16; i++) uExclRad.push(loc(`u_exclRad[${i}]`));
  const uScopeClip = loc("u_scopeClip");
  const uScopeRad = loc("u_scopeRad");
  const uRip: (WebGLUniformLocation | null)[] = [];
  for (let i = 0; i < 16; i++) uRip.push(loc(`u_rip[${i}]`));

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const ripples: Ripple[] = [];
  let raf = 0;
  let running = false;
  let texReady = false;
  let capturing = false;
  let capturePromise: Promise<void> | null = null;
  let disposed = false;

  const invalidateTexture = () => {
    texReady = false;
  };
  const onViewportChange = () => invalidateTexture();
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, { capture: true, passive: true });

  const syncSize = () => {
    const dpr = devicePixelRatio || 1;
    const w = isBody ? innerWidth : scopeEl.clientWidth;
    const h = isBody ? innerHeight : scopeEl.clientHeight;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (overlay.width !== pw || overlay.height !== ph) {
      overlay.width = pw;
      overlay.height = ph;
      gl.viewport(0, 0, pw, ph);
    }
  };
  syncSize();

  const clearOverlay = () => {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  const capture = async () => {
    if (disposed) return;
    if (texReady && !capturePromise) return;
    if (capturePromise) {
      await capturePromise;
      if (texReady || disposed) return;
    }
    capturePromise = (async () => {
      capturing = true;
      clearOverlay();
      try {
      const dpr = devicePixelRatio || 1;
      const fullW = innerWidth;
      const fullH = innerHeight;

      const uploadCanvas = (canvas: HTMLCanvasElement) => {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          canvas
        );
        texReady = true;
        syncSize();
      };

      const fullPw = Math.round(fullW * dpr);
      const fullPh = Math.round(fullH * dpr);
      const frozenScrollX = window.scrollX;
      const frozenScrollY = window.scrollY;

      let srScoped: {
        left: number;
        top: number;
        width: number;
        height: number;
      } | null = null;
      if (!isBody) {
        const r = scopeEl.getBoundingClientRect();
        const cs = getComputedStyle(scopeEl);
        const bl = parseFloat(cs.borderLeftWidth) || 0;
        const bt = parseFloat(cs.borderTopWidth) || 0;
        srScoped = {
          left: r.left + bl,
          top: r.top + bt,
          width: scopeEl.clientWidth,
          height: scopeEl.clientHeight,
        };
      }

      const filter = (node: Node) => {
        if (
          node instanceof Element &&
          node.hasAttribute(RIPPPL_CAPTURE_IGNORE_ATTR)
        )
          return false;
        return true;
      };

      const ignoreOverlay = (el: Element) =>
        el.hasAttribute(RIPPPL_CAPTURE_IGNORE_ATTR);

      let scopedDirect = false;
      let dataUrl: string | undefined;
      if (!isBody) {
        try {
          const scopedCanvas = await html2canvas(scopeEl, {
            scale: dpr,
            backgroundColor: null,
            logging: false,
            useCORS: true,
            ignoreElements: (el) =>
              el instanceof Element && ignoreOverlay(el),
          });
          if (scopedCanvas.width >= 1 && scopedCanvas.height >= 1) {
            try {
              dataUrl = scopedCanvas.toDataURL("image/png");
              scopedDirect = true;
            } catch {
              dataUrl = undefined;
            }
          }
        } catch {
          dataUrl = undefined;
        }
      }
      if (!dataUrl) {
        scopedDirect = false;
        try {
          const viewportCanvas = await html2canvas(document.documentElement, {
            scale: dpr,
            scrollX: frozenScrollX,
            scrollY: frozenScrollY,
            windowWidth: fullW,
            windowHeight: fullH,
            x: frozenScrollX,
            y: frozenScrollY,
            width: fullW,
            height: fullH,
            backgroundColor: null,
            logging: false,
            useCORS: true,
            ignoreElements: (el) =>
              el instanceof Element && ignoreOverlay(el),
          });
          if (viewportCanvas.width >= 1 && viewportCanvas.height >= 1) {
            try {
              dataUrl = viewportCanvas.toDataURL("image/png");
            } catch {
              dataUrl = undefined;
            }
          }
        } catch {
          dataUrl = undefined;
        }
      }
      if (!dataUrl) {
        try {
          dataUrl = await domtoimage.toPng(document.documentElement, {
            width: fullW,
            height: fullH,
            scale: dpr,
            style: {
              transform: `translate(${-frozenScrollX}px, ${-frozenScrollY}px)`,
              transformOrigin: "top left",
              width: fullW + "px",
              height: fullH + "px",
            },
            filter,
          });
          scopedDirect = false;
        } catch {
          return;
        }
      }
      if (disposed) return;

      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      if (disposed) return;

      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      if (iw < 1 || ih < 1) return;

      if (isBody) {
        const tmpCanvas = document.createElement("canvas");
        tmpCanvas.width = fullPw;
        tmpCanvas.height = fullPh;
        const ctx = tmpCanvas.getContext("2d")!;
        ctx.fillStyle = sampleFillFromCrop(img, 0, 0, iw, ih, document.body);
        ctx.fillRect(0, 0, fullPw, fullPh);
        ctx.drawImage(img, 0, 0, iw, ih, 0, 0, fullPw, fullPh);
        uploadCanvas(tmpCanvas);
      } else {
        const sr = srScoped!;
        if (sr.width < 1 || sr.height < 1) return;
        const destW = Math.round(sr.width * dpr);
        const destH = Math.round(sr.height * dpr);

        const tmpCanvas = document.createElement("canvas");
        tmpCanvas.width = destW;
        tmpCanvas.height = destH;
        const ctx = tmpCanvas.getContext("2d")!;
        let cropFillRadiusForExclude = 0;
        for (const ex of excludeEls) {
          cropFillRadiusForExclude = Math.max(
            cropFillRadiusForExclude,
            effectiveExcludeRadiusPx(ex, scopeEl)
          );
        }
        const fillRadiusPx =
          cropFillRadiusForExclude > 0 ? cropFillRadiusForExclude : undefined;

        if (scopedDirect) {
          ctx.fillStyle = sampleFillFromCrop(
            img,
            0,
            0,
            iw,
            ih,
            scopeEl,
            fillRadiusPx
          );
          ctx.fillRect(0, 0, destW, destH);
          ctx.drawImage(img, 0, 0, iw, ih, 0, 0, destW, destH);
        } else {
        const sx = (sr.left / fullW) * iw;
        const sy = (sr.top / fullH) * ih;
        const sw = (sr.width / fullW) * iw;
        const sh = (sr.height / fullH) * ih;

        const fullVis =
          sr.left >= -0.5 &&
          sr.top >= -0.5 &&
          sr.left + sr.width <= fullW + 0.5 &&
          sr.top + sr.height <= fullH + 0.5;

        if (fullVis) {
          ctx.fillStyle = sampleFillFromCrop(
            img,
            sx,
            sy,
            sw,
            sh,
            scopeEl,
            fillRadiusPx
          );
          ctx.fillRect(0, 0, destW, destH);
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, destW, destH);
        } else {
          const visLeft = Math.min(fullW, Math.max(0, sr.left));
          const visTop = Math.min(fullH, Math.max(0, sr.top));
          const visRight = Math.min(fullW, Math.max(0, sr.left + sr.width));
          const visBottom = Math.min(fullH, Math.max(0, sr.top + sr.height));
          const visW = visRight - visLeft;
          const visH = visBottom - visTop;
          if (visW < 1 || visH < 1) return;

          let sx = Math.round((visLeft / fullW) * iw);
          let sy = Math.round((visTop / fullH) * ih);
          let sw = Math.round((visW / fullW) * iw);
          let sh = Math.round((visH / fullH) * ih);
          sx = Math.min(Math.max(0, sx), iw - 1);
          sy = Math.min(Math.max(0, sy), ih - 1);
          sw = Math.min(Math.max(1, sw), iw - sx);
          sh = Math.min(Math.max(1, sh), ih - sy);

          let dstX = Math.round(((visLeft - sr.left) / sr.width) * destW);
          let dstY = Math.round(((visTop - sr.top) / sr.height) * destH);
          let dstW = Math.round((visW / sr.width) * destW);
          let dstH = Math.round((visH / sr.height) * destH);
          dstX = Math.max(0, Math.min(dstX, destW - 1));
          dstY = Math.max(0, Math.min(dstY, destH - 1));
          dstW = Math.max(1, Math.min(dstW, destW - dstX));
          dstH = Math.max(1, Math.min(dstH, destH - dstY));

          ctx.fillStyle = sampleFillFromCrop(
            img,
            sx,
            sy,
            sw,
            sh,
            scopeEl,
            fillRadiusPx
          );
          ctx.fillRect(0, 0, destW, destH);
          ctx.drawImage(img, sx, sy, sw, sh, dstX, dstY, dstW, dstH);
        }
        }
        uploadCanvas(tmpCanvas);
      }
      } catch {
        /* silent */
      } finally {
        capturing = false;
      }

      if (texReady && ripples.length > 0 && !running) {
        running = true;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(tick);
      }
    })();
    try {
      await capturePromise;
    } finally {
      capturePromise = null;
    }
  };

  const tick = () => {
    const now = performance.now() / 1000;

    let i = 0;
    while (i < ripples.length) {
      if (now - ripples[i].t0 > duration) ripples.splice(i, 1);
      else i++;
    }

    if (ripples.length === 0) {
      clearOverlay();
      running = false;
      return;
    }

    if (!texReady) {
      raf = requestAnimationFrame(tick);
      return;
    }

    syncSize();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const cssW = isBody ? innerWidth : scopeEl.clientWidth;
    const cssH = isBody ? innerHeight : scopeEl.clientHeight;
    gl.uniform2f(uRes, overlay.width, overlay.height);
    gl.uniform2f(uCss, cssW, cssH);
    gl.uniform1f(uTime, now);
    gl.uniform1i(uCount, ripples.length);
    gl.uniform1f(uFreq, freq);
    gl.uniform1f(uSpeed, speed);
    gl.uniform1f(uAmp, amp);
    gl.uniform1f(uDamp, damp);
    gl.uniform1f(uDecay, decay);
    gl.uniform1f(uChroma, chromatic ? chromaticIntensity : 0.0);
    gl.uniform3f(uShimColor, shimColor[0], shimColor[1], shimColor[2]);
    gl.uniform1f(uShimStr, shimStr);
    gl.uniform1f(uShimWidth, shimWidth);
    gl.uniform1f(
      uShimIntScale,
      1 / Math.sqrt(Math.max(0.2, shimWidth))
    );
    gl.uniform1f(uShimDur, shimDur);
    if (uScopeClip && uScopeRad) {
      if (isBody) {
        gl.uniform1f(uScopeClip, 0);
        gl.uniform1f(uScopeRad, 0);
      } else {
        gl.uniform1f(uScopeClip, 1);
        gl.uniform1f(uScopeRad, parseBorderRadiusMinPx(scopeEl));
      }
    }
    gl.uniform3f(
      uGlowDodge,
      glowPalette.dodge[0],
      glowPalette.dodge[1],
      glowPalette.dodge[2]
    );
    gl.uniform3f(
      uGlowScreen,
      glowPalette.screen[0],
      glowPalette.screen[1],
      glowPalette.screen[2]
    );
    gl.uniform3f(
      uGlowMix,
      glowPalette.mix[0],
      glowPalette.mix[1],
      glowPalette.mix[2]
    );

    for (let j = 0; j < Math.min(ripples.length, 16); j++) {
      gl.uniform3f(uRip[j], ripples[j].cx, ripples[j].cy, ripples[j].t0);
    }

    const sr = scopeRect();
    const ec = Math.min(excludeEls.length, 16);
    gl.uniform1i(uExclCount, ec);
    for (let j = 0; j < 16; j++) {
      if (j < ec) {
        const el = excludeEls[j];
        const er = el.getBoundingClientRect();
        const x = (er.left - sr.left) / sr.width;
        const y = (er.top - sr.top) / sr.height;
        const zw = er.width / sr.width;
        const zh = er.height / sr.height;
        gl.uniform4f(uExcl[j], x, y, zw, zh);
        const rPx = effectiveExcludeRadiusPx(el, scopeEl);
        gl.uniform1f(uExclRad[j], rPx);
      } else {
        gl.uniform4f(uExcl[j], 0, 0, 0, 0);
        gl.uniform1f(uExclRad[j], 0);
      }
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    raf = requestAnimationFrame(tick);
  };

  const emitRipple = async (cx: number, cy: number) => {
    if (disposed) return;
    const nx = clamp01(cx);
    const ny = clamp01(cy);
    if (!texReady) await capture();
    const t0 = performance.now() / 1000;
    ripples.push({ cx: nx, cy: ny, t0 });
    if (ripples.length > 16) ripples.shift();
    if (texReady && !running) {
      running = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    }
  };

  const onClick = async (e: Event) => {
    if (!(e instanceof MouseEvent) || e.button !== 0) return;
    const rect = scopeRect();
    const cx = (e.clientX - rect.left) / rect.width;
    const cy = (e.clientY - rect.top) / rect.height;
    await emitRipple(cx, cy);
  };

  const prewarmCapture = () => {
    if (!disposed && !texReady) void capture();
  };
  triggers.forEach((el) => {
    el.addEventListener("click", onClick, true);
    el.addEventListener("pointerdown", prewarmCapture, { passive: true });
  });

  const warmCapture = () => {
    if (!disposed && !texReady && !capturePromise) void capture();
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(warmCapture, { timeout: 1200 });
  } else {
    setTimeout(warmCapture, 300);
  }

  return {
    destroy() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, { capture: true } as AddEventListenerOptions);
      triggers.forEach((el) => {
        el.removeEventListener("click", onClick, true);
        el.removeEventListener("pointerdown", prewarmCapture);
      });
      overlay.remove();
    },
    invalidateCapture() {
      if (!disposed) invalidateTexture();
    },
    prefetchCapture() {
      if (!disposed) void capture();
    },
    trigger(opts?: {
      x?: number;
      y?: number;
      fromElement?: HTMLElement;
    }) {
      if (opts?.fromElement) {
        const rect = scopeRect();
        const r = opts.fromElement.getBoundingClientRect();
        const cx = (r.left + r.width * 0.5 - rect.left) / rect.width;
        const cy = (r.top + r.height * 0.5 - rect.top) / rect.height;
        void emitRipple(clamp01(cx), clamp01(cy));
        return;
      }
      const x = opts?.x ?? 0.5;
      const y = opts?.y ?? 0.5;
      void emitRipple(x, y);
    },
    update(opts: Partial<RippleTuning>) {
      if (opts.amplitude !== undefined) amp = opts.amplitude;
      if (opts.frequency !== undefined) freq = opts.frequency;
      if (opts.speed !== undefined) speed = opts.speed;
      if (opts.damping !== undefined) damp = opts.damping;
      if (opts.decay !== undefined) decay = opts.decay;
      if (opts.duration !== undefined) duration = opts.duration / 1000;
      if (opts.chromatic !== undefined) chromatic = opts.chromatic;
      if (opts.chromaticIntensity !== undefined)
        chromaticIntensity = opts.chromaticIntensity;
      if (opts.shimmer !== undefined) {
        if (opts.shimmer) {
          shimColor = parseOklchToLinearRgb(opts.shimmer);
          shimStr = 1.0;
        } else {
          shimStr = 0.0;
        }
      }
      if (opts.shimmerWidth !== undefined) shimWidth = opts.shimmerWidth;
      if (opts.shimmerDuration !== undefined)
        shimDur = opts.shimmerDuration / 1000;
      if (opts.shimmerGlowColor !== undefined)
        glowOklch = opts.shimmerGlowColor;
      if (opts.shimmer !== undefined || opts.shimmerGlowColor !== undefined)
        glowPalette = computeGlowPalette();
    },
  };
}

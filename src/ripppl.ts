import domtoimage from "dom-to-image-more";

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
};

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
  trigger: (opts?: { x?: number; y?: number }) => void;
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

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  uv.y = 1.0 - uv.y;
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
      r += texture2D(u_tex, uv + d + rOff).r * w;
      g += texture2D(u_tex, uv + d + gOff).g * w;
      b += texture2D(u_tex, uv + d + bOff).b * w;
    }
    col = vec3(r, g, b) / tw;
  } else {
    col = texture2D(u_tex, uv + d).rgb;
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
  overlay.setAttribute("data-ripppl-overlay", "");
  if (isBody) {
    overlay.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;";
  } else {
    const pos = getComputedStyle(scopeEl).position;
    if (pos === "static") scopeEl.style.position = "relative";
    const cs = getComputedStyle(scopeEl);
    overlay.style.cssText =
      "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;";
    overlay.style.borderRadius = cs.borderRadius;
    overlay.style.overflow = "hidden";
  }
  (isBody ? document.body : scopeEl).appendChild(overlay);

  const gl = overlay.getContext("webgl", {
    premultipliedAlpha: true,
    alpha: true,
  })!;
  if (!gl) {
    overlay.remove();
    return {
      destroy() {},
      update() {},
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
  let disposed = false;

  const syncSize = () => {
    const dpr = devicePixelRatio || 1;
    const w = isBody ? innerWidth : scopeEl.clientWidth;
    const h = isBody ? innerHeight : scopeEl.clientHeight;
    const pw = w * dpr;
    const ph = h * dpr;
    if (overlay.width !== pw || overlay.height !== ph) {
      overlay.width = pw;
      overlay.height = ph;
      gl.viewport(0, 0, pw, ph);
    }
  };

  const clearOverlay = () => {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  const capture = async () => {
    if (capturing || disposed) return;
    capturing = true;
    clearOverlay();
    try {
      const dpr = devicePixelRatio || 1;
      const fullW = innerWidth;
      const fullH = innerHeight;

      const filter = (node: Node) => {
        if (node instanceof Element && node.hasAttribute("data-ripppl-overlay"))
          return false;
        return true;
      };

      const fullPw = Math.round(fullW * dpr);
      const fullPh = Math.round(fullH * dpr);

      const dataUrl: string = await domtoimage.toPng(document.documentElement, {
        width: fullPw,
        height: fullPh,
        style: {
          transform: `scale(${dpr})`,
          transformOrigin: "top left",
          width: fullW + "px",
          height: fullH + "px",
        },
        filter,
      });
      if (disposed) return;

      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      if (disposed) return;

      let srcX = 0;
      let srcY = 0;
      let destW = fullPw;
      let destH = fullPh;

      if (!isBody) {
        const rect = scopeEl.getBoundingClientRect();
        srcX = Math.round(rect.left * dpr);
        srcY = Math.round(rect.top * dpr);
        destW = Math.round(rect.width * dpr);
        destH = Math.round(rect.height * dpr);
      }

      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.width = destW;
      tmpCanvas.height = destH;
      const ctx = tmpCanvas.getContext("2d")!;
      ctx.drawImage(img, srcX, srcY, destW, destH, 0, 0, destW, destH);

      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        tmpCanvas
      );
      texReady = true;
      syncSize();
    } catch {
      /* silent */
    }
    capturing = false;

    if (texReady && ripples.length > 0 && !running) {
      running = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
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
      texReady = false;
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

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    raf = requestAnimationFrame(tick);
  };

  const emitRipple = async (cx: number, cy: number) => {
    if (disposed) return;
    const nx = clamp01(cx);
    const ny = clamp01(cy);
    if (!running && !capturing) await capture();
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
    const rect = isBody
      ? { left: 0, top: 0, width: innerWidth, height: innerHeight }
      : scopeEl.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width;
    const cy = (e.clientY - rect.top) / rect.height;
    await emitRipple(cx, cy);
  };

  triggers.forEach((el) => el.addEventListener("click", onClick, true));

  return {
    destroy() {
      disposed = true;
      cancelAnimationFrame(raf);
      triggers.forEach((el) => el.removeEventListener("click", onClick, true));
      overlay.remove();
    },
    trigger(opts?: { x?: number; y?: number }) {
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

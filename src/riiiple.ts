import domtoimage from "dom-to-image-more";

export type RippleOptions = {
  scope?: string | HTMLElement;
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
};

function parseOklchToLinearRgb(css: string): [number, number, number] {
  const s = css.trim();
  if (!/^oklch\s*\(/i.test(s)) return [1, 1, 1];
  const el = document.createElement("div");
  el.style.color = s;
  document.documentElement.appendChild(el);
  const out = getComputedStyle(el).color;
  el.remove();
  const comma = out.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/
  );
  if (comma)
    return [
      parseFloat(comma[1]) / 255,
      parseFloat(comma[2]) / 255,
      parseFloat(comma[3]) / 255,
    ];
  const space = out.match(/rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (space)
    return [
      parseFloat(space[1]) / 255,
      parseFloat(space[2]) / 255,
      parseFloat(space[3]) / 255,
    ];
  return [1, 1, 1];
}

export type RippleHandle = {
  destroy: () => void;
  update: (opts: Partial<RippleOptions>) => void;
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
uniform float u_shimDur;

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  uv.y = 1.0 - uv.y;
  vec2 d = vec2(0.0);
  float maxShim = 0.0;
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
    float shimEdge = shimEnter * shimBell * shimTail * opacityFade * center;
    maxShim = max(maxShim, shimEdge);
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
    float sm = clamp(maxShim * u_shimStr + (di - 0.5) * 0.012, 0.0, 1.0);
    col = mix(col, u_shimColor, sm);
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

  const overlay = document.createElement("canvas");
  overlay.setAttribute("data-riiiple-overlay", "");
  if (isBody) {
    overlay.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;";
  } else {
    const pos = getComputedStyle(scopeEl).position;
    if (pos === "static") scopeEl.style.position = "relative";
    overlay.style.cssText =
      "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;";
  }
  (isBody ? document.body : scopeEl).appendChild(overlay);

  const gl = overlay.getContext("webgl", {
    premultipliedAlpha: true,
    alpha: true,
  })!;
  if (!gl)
    return {
      destroy() {},
      update() {},
    };

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
  const uShimDur = loc("u_shimDur");
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
        if (node instanceof Element && node.hasAttribute("data-riiiple-overlay"))
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
    gl.uniform1f(uShimDur, shimDur);

    for (let j = 0; j < Math.min(ripples.length, 16); j++) {
      gl.uniform3f(uRip[j], ripples[j].cx, ripples[j].cy, ripples[j].t0);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    raf = requestAnimationFrame(tick);
  };

  const onClick = async (e: Event) => {
    if (!(e instanceof MouseEvent) || e.button !== 0) return;

    const rect = isBody
      ? { left: 0, top: 0, width: innerWidth, height: innerHeight }
      : scopeEl.getBoundingClientRect();

    const cx = (e.clientX - rect.left) / rect.width;
    const cy = (e.clientY - rect.top) / rect.height;

    if (!running && !capturing) {
      await capture();
    }

    const t0 = performance.now() / 1000;
    ripples.push({ cx, cy, t0 });
    if (ripples.length > 16) ripples.shift();

    if (texReady && !running) {
      running = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    }
  };

  triggers.forEach((el) => el.addEventListener("click", onClick, true));

  return {
    destroy() {
      disposed = true;
      cancelAnimationFrame(raf);
      triggers.forEach((el) => el.removeEventListener("click", onClick, true));
      overlay.remove();
    },
    update(opts) {
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
    },
  };
}

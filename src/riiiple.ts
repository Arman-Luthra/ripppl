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
};

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

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  uv.y = 1.0 - uv.y;
  vec2 d = vec2(0.0);
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
      const target = isBody ? document.documentElement : scopeEl;
      const w = isBody ? innerWidth : scopeEl.clientWidth;
      const h = isBody ? innerHeight : scopeEl.clientHeight;

      const filter = (node: Node) => {
        if (node instanceof Element && node.hasAttribute("data-riiiple-overlay"))
          return false;
        return true;
      };

      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);

      const dataUrl: string = await domtoimage.toPng(target, {
        width: pw,
        height: ph,
        style: {
          transform: `scale(${dpr})`,
          transformOrigin: "top left",
          width: w + "px",
          height: h + "px",
        },
        filter,
      });
      if (disposed) return;

      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      if (disposed) return;

      const tmpCanvas = document.createElement("canvas");
      tmpCanvas.width = pw;
      tmpCanvas.height = ph;
      const ctx = tmpCanvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, pw, ph);

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
    gl.uniform1f(uChroma, chromatic ? 0.4 : 0.0);

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
    },
  };
}

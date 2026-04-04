import html2canvas from "html2canvas";

export type RippleOptions = {
  scope?: string | HTMLElement;
  amplitude?: number;
  frequency?: number;
  speed?: number;
  damping?: number;
  decay?: number;
  duration?: number;
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
  gl_FragColor = texture2D(u_tex, uv + d);
}`;

export function attachRipple(
  trigger: TriggerInput,
  options: RippleOptions = {}
): RippleHandle {
  const triggers = resolveTriggers(trigger);
  const scopeEl = resolveScope(options.scope);
  const isBody = scopeEl === document.body;

  let amp = options.amplitude ?? 3.0;
  let freq = options.frequency ?? 0.05;
  let speed = options.speed ?? 300.0;
  let damp = options.damping ?? 0.008;
  let decay = options.decay ?? 1.2;
  let duration = (options.duration ?? 3500) / 1000;

  const overlay = document.createElement("canvas");
  if (isBody) {
    overlay.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;display:none;";
  } else {
    const pos = getComputedStyle(scopeEl).position;
    if (pos === "static") scopeEl.style.position = "relative";
    overlay.style.cssText =
      "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;display:none;";
  }
  (isBody ? document.body : scopeEl).appendChild(overlay);

  const gl = overlay.getContext("webgl", {
    premultipliedAlpha: false,
    alpha: false,
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

  const capture = async () => {
    if (capturing || disposed) return;
    capturing = true;
    overlay.style.display = "none";
    try {
      const dpr = devicePixelRatio || 1;
      const fullSnap = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        scale: dpr,
        logging: false,
        width: innerWidth,
        height: innerHeight,
        windowWidth: innerWidth,
        windowHeight: innerHeight,
        ignoreElements: (el: Element) =>
          el.hasAttribute("data-riiiple-ignore"),
      });
      if (disposed) return;

      let source: HTMLCanvasElement = fullSnap;

      if (!isBody) {
        const rect = scopeEl.getBoundingClientRect();
        const crop = document.createElement("canvas");
        crop.width = Math.round(rect.width * dpr);
        crop.height = Math.round(rect.height * dpr);
        const ctx = crop.getContext("2d")!;
        ctx.drawImage(
          fullSnap,
          Math.round(rect.left * dpr),
          Math.round(rect.top * dpr),
          crop.width,
          crop.height,
          0,
          0,
          crop.width,
          crop.height
        );
        source = crop;
      }

      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source
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
      overlay.style.display = "none";
      running = false;
      capture();
      return;
    }

    if (!texReady) {
      raf = requestAnimationFrame(tick);
      return;
    }

    syncSize();
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

    for (let j = 0; j < Math.min(ripples.length, 16); j++) {
      gl.uniform3f(uRip[j], ripples[j].cx, ripples[j].cy, ripples[j].t0);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    overlay.style.display = "";
    raf = requestAnimationFrame(tick);
  };

  const onClick = async (e: Event) => {
    if (!(e instanceof MouseEvent) || e.button !== 0) return;

    const rect = isBody
      ? { left: 0, top: 0, width: innerWidth, height: innerHeight }
      : scopeEl.getBoundingClientRect();

    const cx = (e.clientX - rect.left) / rect.width;
    const cy = (e.clientY - rect.top) / rect.height;
    const t0 = performance.now() / 1000;

    ripples.push({ cx, cy, t0 });
    if (ripples.length > 16) ripples.shift();

    if (!texReady && !capturing) {
      await capture();
    }

    if (texReady && !running) {
      running = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    }
  };

  triggers.forEach((el) => el.addEventListener("click", onClick, true));

  capture();

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
    },
  };
}

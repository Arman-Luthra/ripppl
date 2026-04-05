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
  float maxEnv = 0.0;
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

    float env = abs(wave) * u_amp * center;
    maxEnv = max(maxEnv, env);
    d -= normalize(diff) * wave * u_amp * center;
  }
  d /= u_css;
  vec3 col = texture2D(u_tex, uv + d).rgb;
  float alpha = smoothstep(0.0, 0.3, maxEnv);
  gl_FragColor = vec4(col * alpha, alpha);
}`;

function cloneNativeControls(doc: Document) {
  const win = doc.defaultView;

  doc.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((el) => {
    const cs = win?.getComputedStyle(el);
    const isNative =
      cs?.appearance === "auto" ||
      cs?.webkitAppearance === "slider-horizontal" ||
      (!cs?.appearance && !cs?.webkitAppearance);

    if (!isNative) return;

    const w = el.offsetWidth || parseFloat(cs?.width || "200");
    const h = el.offsetHeight || parseFloat(cs?.height || "20");
    const min = parseFloat(el.min || "0");
    const max = parseFloat(el.max || "100");
    const val = parseFloat(el.value || String((min + max) / 2));
    const pct = Math.max(0, Math.min(1, (val - min) / (max - min)));
    const trackH = 4;
    const thumbD = 14;
    const thumbX = pct * (w - thumbD);

    const box = doc.createElement("div");
    box.style.cssText = `position:relative;width:${w}px;height:${h}px;display:inline-block;vertical-align:middle;`;

    const track = doc.createElement("div");
    track.style.cssText = `position:absolute;left:0;top:${(h - trackH) / 2}px;width:${w}px;height:${trackH}px;border-radius:${trackH / 2}px;background:#555;`;
    box.appendChild(track);

    const fill = doc.createElement("div");
    fill.style.cssText = `position:absolute;left:0;top:0;width:${pct * 100}%;height:100%;border-radius:${trackH / 2}px;background:#7b8cde;`;
    track.appendChild(fill);

    const thumb = doc.createElement("div");
    thumb.style.cssText = `position:absolute;left:${thumbX}px;top:${(h - thumbD) / 2}px;width:${thumbD}px;height:${thumbD}px;border-radius:50%;background:#7b8cde;`;
    box.appendChild(thumb);

    el.replaceWith(box);
  });

  doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((el) => {
    const cs = win?.getComputedStyle(el);
    const s = el.offsetWidth || parseFloat(cs?.width || "16");
    const accent = cs?.accentColor !== "auto" ? cs?.accentColor : "#7b8cde";

    const box = doc.createElement("div");
    box.style.cssText = `display:inline-block;width:${s}px;height:${s}px;border-radius:3px;vertical-align:middle;` +
      (el.checked
        ? `background:${accent};`
        : `background:transparent;border:2px solid #888;box-sizing:border-box;`);

    if (el.checked) {
      const check = doc.createElement("div");
      const inset = Math.round(s * 0.25);
      const tickW = Math.round(s * 0.5);
      const tickH = Math.round(s * 0.3);
      check.style.cssText = `position:relative;left:${inset}px;top:${inset}px;width:${tickW}px;height:${tickH}px;` +
        `border-left:2px solid #fff;border-bottom:2px solid #fff;transform:rotate(-45deg);`;
      box.appendChild(check);
    }
    el.replaceWith(box);
  });

  doc.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((el) => {
    const cs = win?.getComputedStyle(el);
    const s = el.offsetWidth || parseFloat(cs?.width || "16");
    const accent = cs?.accentColor !== "auto" ? cs?.accentColor : "#7b8cde";

    const box = doc.createElement("div");
    box.style.cssText = `display:inline-block;width:${s}px;height:${s}px;border-radius:50%;vertical-align:middle;box-sizing:border-box;` +
      (el.checked
        ? `background:${accent};border:3px solid ${accent};`
        : `background:transparent;border:2px solid #888;`);

    if (el.checked) {
      const dot = doc.createElement("div");
      const dotS = Math.round(s * 0.4);
      dot.style.cssText = `width:${dotS}px;height:${dotS}px;border-radius:50%;background:#fff;margin:${(s - dotS) / 2 - 3}px auto 0;`;
      box.appendChild(dot);
    }
    el.replaceWith(box);
  });

  doc.querySelectorAll<HTMLSelectElement>("select").forEach((el) => {
    const cs = win?.getComputedStyle(el);
    const w = el.offsetWidth || parseFloat(cs?.width || "120");
    const h = el.offsetHeight || parseFloat(cs?.height || "28");
    const bg = cs?.backgroundColor || "#333";
    const color = cs?.color || "#eee";
    const text = el.selectedOptions?.[0]?.text || "";

    const box = doc.createElement("div");
    box.style.cssText = `display:inline-flex;align-items:center;justify-content:space-between;width:${w}px;height:${h}px;` +
      `padding:0 8px;box-sizing:border-box;background:${bg};color:${color};border:1px solid #666;border-radius:4px;font:inherit;`;
    const span = doc.createElement("span");
    span.textContent = text;
    span.style.cssText = "overflow:hidden;white-space:nowrap;text-overflow:ellipsis;";
    const arrow = doc.createElement("span");
    arrow.textContent = "\u25BC";
    arrow.style.cssText = "font-size:0.6em;opacity:0.6;margin-left:4px;";
    box.appendChild(span);
    box.appendChild(arrow);
    el.replaceWith(box);
  });

  doc.querySelectorAll<HTMLProgressElement>("progress").forEach((el) => {
    const cs = win?.getComputedStyle(el);
    const w = el.offsetWidth || parseFloat(cs?.width || "160");
    const h = el.offsetHeight || parseFloat(cs?.height || "16");
    const pct = el.max > 0 ? el.value / el.max : 0;
    const accent = cs?.accentColor !== "auto" ? cs?.accentColor : "#7b8cde";

    const box = doc.createElement("div");
    box.style.cssText = `display:inline-block;width:${w}px;height:${h}px;background:#444;border-radius:${h / 2}px;overflow:hidden;vertical-align:middle;`;
    const fill = doc.createElement("div");
    fill.style.cssText = `width:${pct * 100}%;height:100%;background:${accent};border-radius:${h / 2}px;`;
    box.appendChild(fill);
    el.replaceWith(box);
  });

  doc.querySelectorAll<HTMLMeterElement>("meter").forEach((el) => {
    const cs = win?.getComputedStyle(el);
    const w = el.offsetWidth || parseFloat(cs?.width || "160");
    const h = el.offsetHeight || parseFloat(cs?.height || "16");
    const range = (el.max || 1) - (el.min || 0);
    const pct = range > 0 ? ((el.value || 0) - (el.min || 0)) / range : 0;

    const box = doc.createElement("div");
    box.style.cssText = `display:inline-block;width:${w}px;height:${h}px;background:#444;border-radius:${h / 2}px;overflow:hidden;vertical-align:middle;`;
    const fill = doc.createElement("div");
    fill.style.cssText = `width:${pct * 100}%;height:100%;background:#6b6;border-radius:${h / 2}px;`;
    box.appendChild(fill);
    el.replaceWith(box);
  });
}

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
        onclone: (clonedDoc: Document) => cloneNativeControls(clonedDoc),
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

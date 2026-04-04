export type RippleOptions = {
  scope?: string | HTMLElement;
  maxScale?: number;
  attackMs?: number;
  decayRate?: number;
  baseFrequency?: number;
  frequencyDrift?: number;
  octaves?: number;
  noiseType?: "turbulence" | "fractalNoise";
};

type TriggerInput =
  | string
  | HTMLElement
  | NodeListOf<HTMLElement>
  | HTMLElement[];

let uid = 0;
let frameSeed = 0;

function resolveTriggers(input: TriggerInput): HTMLElement[] {
  if (typeof input === "string") {
    return Array.from(document.querySelectorAll<HTMLElement>(input));
  }
  if (input instanceof HTMLElement) {
    return [input];
  }
  return Array.from(input);
}

function resolveScope(scope: string | HTMLElement | undefined): HTMLElement {
  if (!scope) return document.body;
  if (typeof scope === "string") {
    return document.querySelector<HTMLElement>(scope) ?? document.body;
  }
  return scope;
}

export function attachRipple(
  trigger: TriggerInput,
  options: RippleOptions = {}
): () => void {
  const triggers = resolveTriggers(trigger);
  const scopeEl = resolveScope(options.scope);

  const maxScale = options.maxScale ?? 40;
  const attackMs = options.attackMs ?? 100;
  const decayRate = options.decayRate ?? 0.0025;
  const baseFreq = options.baseFrequency ?? 0.012;
  const freqDrift = options.frequencyDrift ?? 0.004;
  const octaves = options.octaves ?? 3;
  const noiseType = options.noiseType ?? "turbulence";
  const base = `riiiple-${++uid}`;
  const idA = `${base}-a`;
  const idB = `${base}-b`;
  let useA = true;

  const svgA = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgA.setAttribute("width", "0");
  svgA.setAttribute("height", "0");
  svgA.style.cssText = "position:absolute;";

  const svgB = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svgB.setAttribute("width", "0");
  svgB.setAttribute("height", "0");
  svgB.style.cssText = "position:absolute;";

  const buildFilterHtml = (id: string, scale: number, freq: number, seed: number) =>
    `<defs><filter id="${id}" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="${noiseType}" baseFrequency="${freq}" numOctaves="${octaves}" result="turb" seed="${seed}"/><feDisplacementMap in="SourceGraphic" in2="turb" xChannelSelector="R" yChannelSelector="G" scale="${scale}"/></filter></defs>`;

  const writeFilter = (scale: number, freq: number, seed: number) => {
    useA = !useA;
    if (useA) {
      svgA.innerHTML = buildFilterHtml(idA, scale, freq, seed);
      scopeEl.style.filter = `url(#${idA})`;
    } else {
      svgB.innerHTML = buildFilterHtml(idB, scale, freq, seed);
      scopeEl.style.filter = `url(#${idB})`;
    }
  };

  svgA.innerHTML = buildFilterHtml(idA, 0, baseFreq, 0);
  svgB.innerHTML = buildFilterHtml(idB, 0, baseFreq, 0);
  document.body.appendChild(svgA);
  document.body.appendChild(svgB);
  scopeEl.style.filter = `url(#${idA})`;

  const clickTimes: number[] = [];
  let raf = 0;
  let running = false;

  const tick = () => {
    const now = performance.now();

    let totalEnvelope = 0;
    let i = 0;
    while (i < clickTimes.length) {
      const t = now - clickTimes[i];
      const attack = Math.min(t / attackMs, 1);
      const decay = Math.exp(-t * decayRate);
      const env = attack * decay;
      if (env < 0.008) {
        clickTimes.splice(i, 1);
        continue;
      }
      totalEnvelope += env;
      i++;
    }

    if (clickTimes.length === 0) {
      writeFilter(0, baseFreq, 0);
      running = false;
      return;
    }

    const scale = Math.min(totalEnvelope * maxScale, maxScale * 1.8);
    const elapsed = now - clickTimes[0];
    const freq = baseFreq + Math.sin(elapsed * 0.001) * freqDrift;

    writeFilter(scale, freq, ++frameSeed);

    raf = requestAnimationFrame(tick);
  };

  const onClick = (e: Event) => {
    if (!(e instanceof MouseEvent) || e.button !== 0) return;
    clickTimes.push(performance.now());
    if (clickTimes.length > 8) clickTimes.shift();
    cancelAnimationFrame(raf);
    running = true;
    raf = requestAnimationFrame(tick);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible" && running) {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    }
  };

  triggers.forEach((el) => el.addEventListener("click", onClick, true));
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    cancelAnimationFrame(raf);
    scopeEl.style.filter = "";
    triggers.forEach((el) => el.removeEventListener("click", onClick, true));
    document.removeEventListener("visibilitychange", onVisibilityChange);
    svgA.remove();
    svgB.remove();
  };
}

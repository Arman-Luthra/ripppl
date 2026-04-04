export type RippleOptions = {
  maxScale?: number;
  attackMs?: number;
  decayRate?: number;
  baseFrequency?: number;
  frequencyDrift?: number;
  octaves?: number;
  noiseType?: "turbulence" | "fractalNoise";
};

let uid = 0;
let frameSeed = 0;

export function attachRipple(
  target: Document | HTMLElement = document,
  options: RippleOptions = {}
): () => void {
  const maxScale = options.maxScale ?? 40;
  const attackMs = options.attackMs ?? 100;
  const decayRate = options.decayRate ?? 0.0025;
  const baseFreq = options.baseFrequency ?? 0.012;
  const freqDrift = options.frequencyDrift ?? 0.004;
  const octaves = options.octaves ?? 3;
  const noiseType = options.noiseType ?? "turbulence";
  const filterId = `riiiple-${++uid}`;

  const filterRoot: HTMLElement =
    target instanceof Document ? document.body : target;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.cssText = "position:absolute;";

  const writeFilter = (scale: number, freq: number, seed: number) => {
    svg.innerHTML = `<defs><filter id="${filterId}" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="${noiseType}" baseFrequency="${freq}" numOctaves="${octaves}" result="turb" seed="${seed}"/><feDisplacementMap in="SourceGraphic" in2="turb" xChannelSelector="R" yChannelSelector="G" scale="${scale}"/></filter></defs>`;
  };

  writeFilter(0, baseFreq, 0);
  document.body.appendChild(svg);
  filterRoot.style.filter = `url(#${filterId})`;

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
    const el = target instanceof Document ? null : target;
    if (el && !el.contains(e.target as Node)) return;
    clickTimes.push(performance.now());
    if (clickTimes.length > 8) clickTimes.shift();
    if (!running) {
      running = true;
      raf = requestAnimationFrame(tick);
    }
  };

  target.addEventListener("click", onClick, true);

  return () => {
    cancelAnimationFrame(raf);
    filterRoot.style.filter = "";
    target.removeEventListener("click", onClick, true);
    svg.remove();
  };
}

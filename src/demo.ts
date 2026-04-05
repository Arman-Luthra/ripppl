import { converter, formatCss, formatHex, parse } from "culori";
import { attachRipple, type RippleTuning } from "./ripppl";

const page = attachRipple(".page-trigger");
const card = attachRipple("#card-trigger", { scope: "#demo-card" });
const cardExclude = attachRipple("#exclude-card-trigger", {
  scope: "#demo-card-exclude",
  exclude: "#exclude-card-label",
});

const toOklch = converter("oklch");

function initSlider(el: HTMLElement) {
  const param = el.dataset.param!;
  const min = parseFloat(el.dataset.min!);
  const max = parseFloat(el.dataset.max!);
  const step = parseFloat(el.dataset.step!);
  let value = parseFloat(el.dataset.value!);

  const fill = el.querySelector<HTMLElement>(".slider-fill")!;
  const thumb = el.querySelector<HTMLElement>(".slider-thumb")!;
  const display = document.getElementById(`v-${param}`)!;

  const render = () => {
    const pct = ((value - min) / (max - min)) * 100;
    fill.style.width = `${pct}%`;
    thumb.style.left = `${pct}%`;
    display.textContent = String(
      step < 1 ? parseFloat(value.toFixed(4)) : Math.round(value)
    );
  };

  const setFromX = (clientX: number) => {
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const raw = min + ratio * (max - min);
    value = Math.round(raw / step) * step;
    value = Math.max(min, Math.min(max, value));
    render();
    page.update({ [param]: value });
    card.update({ [param]: value });
    cardExclude.update({ [param]: value });
  };

  const onMove = (e: PointerEvent) => setFromX(e.clientX);
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };

  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    setFromX(e.clientX);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  render();
  const patch = { [param]: value } as Partial<RippleTuning>;
  page.update(patch);
  card.update(patch);
  cardExclude.update(patch);
}

document.querySelectorAll<HTMLElement>(".slider").forEach(initSlider);

const chromaToggle = document.getElementById("t-chromatic")!;
let chromaOn = false;
chromaToggle.addEventListener("click", () => {
  chromaOn = !chromaOn;
  chromaToggle.classList.toggle("on", chromaOn);
  page.update({ chromatic: chromaOn });
  card.update({ chromatic: chromaOn });
  cardExclude.update({ chromatic: chromaOn });
});

const shimToggle = document.getElementById("t-shimmer")!;
const shimColorInput = document.getElementById("shimmer-color") as HTMLInputElement;
const shimColorPicker = document.getElementById("shimmer-color-picker") as HTMLInputElement;
let shimOn = false;
let shimColor = shimColorInput.value;

function hexToOklch(hex: string): string {
  const c = toOklch(parse(hex));
  if (!c) return shimColorInput.value;
  return formatCss(c);
}

function syncPickerFromOklch(oklch: string) {
  const c = parse(oklch.trim());
  if (c) shimColorPicker.value = formatHex(c);
}

const applyShimmer = () => {
  const val = shimOn ? shimColor : false;
  page.update({ shimmer: val });
  card.update({ shimmer: val });
  cardExclude.update({ shimmer: val });
};

shimToggle.addEventListener("click", () => {
  shimOn = !shimOn;
  shimToggle.classList.toggle("on", shimOn);
  applyShimmer();
});

shimColorPicker.addEventListener("input", () => {
  const o = hexToOklch(shimColorPicker.value);
  shimColorInput.value = o;
  shimColor = o;
  if (shimOn) applyShimmer();
});

shimColorInput.addEventListener("input", () => {
  shimColor = shimColorInput.value;
  syncPickerFromOklch(shimColor);
  if (shimOn) applyShimmer();
});

syncPickerFromOklch(shimColorInput.value);

document.getElementById("card-pulse")!.addEventListener("click", () => {
  card.trigger({ x: 0.5, y: 0.5 });
});

const excludeLabel = document.getElementById("exclude-card-label")!;
document.getElementById("exclude-from-label")!.addEventListener("click", () => {
  cardExclude.trigger({ fromElement: excludeLabel });
});

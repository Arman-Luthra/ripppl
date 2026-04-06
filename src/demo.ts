import { converter, formatCss, formatHex, parse } from "culori";
import gsap from "gsap";
import { Draggable } from "gsap/Draggable";
import { attachRipple, type RippleTuning } from "./ripppl";

gsap.registerPlugin(Draggable);

const page = attachRipple(".page-trigger");
const card = attachRipple("#card-trigger", { scope: "#demo-card" });
const cardExclude = attachRipple("#exclude-card-trigger", {
  scope: "#demo-card-exclude",
  exclude: "#exclude-card-label",
});
const dndRipple = attachRipple("#demo-dnd-trigger", {
  scope: "#demo-dnd-scope",
  exclude: "#demo-dnd-image",
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
    dndRipple.update({ [param]: value });
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
  dndRipple.update(patch);
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
  dndRipple.update({ chromatic: chromaOn });
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
  dndRipple.update({ shimmer: val });
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

const dndDropzone = document.getElementById("demo-dnd-dropzone")!;
const dndDragWrap = document.getElementById("demo-dnd-drag-wrap")!;
const dndImage = document.getElementById("demo-dnd-image") as HTMLImageElement;
const dndHint = document.getElementById("demo-dnd-hint")!;
const dndCountdown = document.getElementById("demo-dnd-countdown")!;

function runCountdownThen(
  draggable: { disable: () => void; enable: () => void },
  onDone: () => void
) {
  draggable.disable();
  dndCountdown.classList.add("demo-dnd-countdown--on");
  dndCountdown.setAttribute("aria-hidden", "false");
  const tl = gsap.timeline({
    onComplete: () => {
      dndCountdown.classList.remove("demo-dnd-countdown--on");
      dndCountdown.textContent = "";
      dndCountdown.setAttribute("aria-hidden", "true");
      draggable.enable();
      onDone();
    },
  });
  for (const n of [3, 2, 1]) {
    tl.add(() => {
      dndCountdown.textContent = String(n);
    });
    tl.fromTo(
      dndCountdown,
      { opacity: 0.15, scale: 0.82 },
      { opacity: 1, scale: 1, duration: 0.22, ease: "back.out(1.9)" }
    );
    tl.to(dndCountdown, { duration: 0.62 });
  }
}

const [dndDraggable] = Draggable.create(dndDragWrap, {
  type: "x,y",
  bounds: document.getElementById("demo-dnd-scope")!,
  onDrag() {
    if (Draggable.hitTest(dndDragWrap, dndDropzone, "40%")) {
      dndDropzone.classList.add("demo-dropzone--hit");
    } else {
      dndDropzone.classList.remove("demo-dropzone--hit");
    }
  },
  onDragEnd() {
    const over = Draggable.hitTest(dndDragWrap, dndDropzone, "40%");
    dndDropzone.classList.remove("demo-dropzone--hit");
    if (over) {
      dndHint.textContent = "Get ready…";
      runCountdownThen(dndDraggable, () => {
        dndHint.textContent = "Ripple from image";
        dndRipple.invalidateCapture();
        dndRipple.trigger({ fromElement: dndImage });
      });
    } else {
      dndHint.textContent = "Drop image here";
    }
  },
});

import { attachRipple } from "./riiiple";

const page = attachRipple(".page-trigger");
const card = attachRipple("#card-trigger", { scope: "#demo-card" });

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
}

document.querySelectorAll<HTMLElement>(".slider").forEach(initSlider);

const chromaToggle = document.getElementById("t-chromatic")!;
let chromaOn = false;
chromaToggle.addEventListener("click", () => {
  chromaOn = !chromaOn;
  chromaToggle.classList.toggle("on", chromaOn);
  page.update({ chromatic: chromaOn });
  card.update({ chromatic: chromaOn });
});

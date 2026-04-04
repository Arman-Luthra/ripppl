import { attachRipple } from "./riiiple";

const page = attachRipple(".page-trigger");
const card = attachRipple("#card-trigger", { scope: "#demo-card" });

const params = [
  "amplitude",
  "frequency",
  "speed",
  "damping",
  "decay",
  "duration",
] as const;

for (const key of params) {
  const slider = document.getElementById(`s-${key}`) as HTMLInputElement;
  const display = document.getElementById(`v-${key}`)!;

  slider.addEventListener("input", () => {
    const val = parseFloat(slider.value);
    display.textContent = slider.value;
    page.update({ [key]: val });
    card.update({ [key]: val });
  });
}

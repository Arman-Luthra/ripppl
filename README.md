# riiiple

Ripple displacement over the **real DOM** (WebGL shader + screen capture). Works in the browser only.

## Install

```bash
npm install riiiple
```

## Use

```ts
import { attachRipple } from "riiiple";

const handle = attachRipple("#my-button", {
  scope: "#card",
  amplitude: 3,
  shimmer: "oklch(0.72 0.19 45)",
});

handle.update({ speed: 400 });
handle.trigger({ x: 0.5, y: 0.5 });
handle.destroy();
```

- **`attachRipple(trigger, options?)`** — `trigger` is a selector, element, or list of elements that start a capture + ripple on click. Use **`scope`** to clip the effect to a container (e.g. a card); omit it for a full-page ripple.
- **`update(partial)`** — change tuning; see **`RippleTuning`** in the published types.
- **`trigger({ x?, y? })`** — fire a ripple at normalized **0–1** coordinates inside the scope (default center).
- **`destroy()`** — remove listeners and overlay.

Build before publish: `npm run build` (runs automatically via `prepublishOnly` on `npm publish`).

## License

MIT

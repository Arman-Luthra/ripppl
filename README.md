<h1 align="center">ripppl</h1>

<p align="center">Ripple displacement using WebGL over the DOM.</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Arman-Luthra/ripppl/main/demo_1.gif" alt="" width="49%" />
  <img src="https://raw.githubusercontent.com/Arman-Luthra/ripppl/main/demo-2.gif" alt="" width="49%" />
</p>

## Installation

```bash
npm install ripppl
```

## Usage

```ts
import { attachRipple } from "ripppl";

const handle = attachRipple("#my-button", {
  scope: "#card",
  amplitude: 3,
  shimmer: "oklch(0.72 0.19 45)",
});

handle.update({ speed: 400 });
handle.trigger({ x: 0.5, y: 0.5 });
handle.destroy();
```

`attachRipple` takes a **trigger** (CSS selector, element, or list of elements) and optional options. Clicks on the trigger capture the surrounding DOM and run the ripple. Use **`scope`** to clip the effect to a container; omit **`scope`** for a full-viewport ripple.

The returned **handle** exposes:

| Method | Purpose |
|--------|---------|
| `update(partial)` | Merge new tuning values (see parameters below). |
| `trigger({ x?, y? })` | Start a ripple at normalized coordinates **0–1** inside the scope (default center). |
| `destroy()` | Remove listeners, overlay, and WebGL resources. |

Types: `RippleOptions`, `RippleTuning`, `RippleHandle` are exported from the package.

## Parameters

Options passed to `attachRipple` or `update` (all optional except where noted):

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `scope` | `string` \| `HTMLElement` | `document.body` | Element whose box clips the ripple and capture. |
| `amplitude` | `number` | `3` | Displacement strength of the wave. |
| `frequency` | `number` | `0.018` | Spatial frequency of the ripple rings. |
| `speed` | `number` | `300` | How fast the wave propagates. |
| `damping` | `number` | `0.025` | Ring falloff behind the wave front. |
| `decay` | `number` | `1.2` | How quickly the effect fades over time. |
| `duration` | `number` (ms) | `3500` | Max duration of the animation. |
| `chromatic` | `boolean` | `false` | Chromatic aberration on the displaced image. |
| `chromaticIntensity` | `number` | `0.4` | Strength when `chromatic` is true. |
| `shimmer` | `string` \| `false` | `false` | OKLCH color string for the shimmer pass, or `false` to disable. |
| `shimmerWidth` | `number` | `1` | Width of the shimmer band. |
| `shimmerDuration` | `number` (ms) | `2600` | Shimmer timing relative to the ripple. |
| `shimmerGlowColor` | `string` | — | Optional OKLCH override for glow highlights (uses shimmer color when omitted). |

## Contributing

Issues and pull requests are welcome in [GitHub Issues](https://github.com/Arman-Luthra/ripppl/issues).

Clone the repo, install dependencies, and run the demo or build the library:

```bash
git clone https://github.com/Arman-Luthra/ripppl.git
cd ripppl
npm install
npm run dev
```

```bash
npm run build
```

Please keep changes focused and match existing style. For larger changes, open an issue first so the direction is agreed.

## License

MIT

import { attachRipple } from "./riiiple";

attachRipple(document, {
  maxScale: 35,
  attackMs: 120,
  decayRate: 0.003,
  baseFrequency: 0.012,
  octaves: 3,
  noiseType: "turbulence",
});

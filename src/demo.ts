import { attachRipple } from "./riiiple";

attachRipple(".page-trigger");

attachRipple("#card-trigger", {
  scope: "#demo-card",
  maxScale: 30,
});

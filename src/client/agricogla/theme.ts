/** Agricogla "broadcast-HUD" design tokens, ported from the Claude Design
 *  prototype (Agricogla.dc.html). Dark charcoal table, ember-orange brand,
 *  cyan for DMs/replay, green for live. */
import { CSSProperties } from "react";
import { Good } from "../../shared/engine/types";

export const C = {
  bg: "#07090d",
  panelTop: "#161b26",
  panelBot: "#11151d",
  panel: "linear-gradient(180deg, #161b26, #11151d)",
  border: "#232b3a",
  borderSoft: "#1a2130",
  ink: "#eaf0fb",
  inkDim: "#b6c0d2",
  inkSoft: "#d7deeb",
  muted: "#6a7585",
  faint: "#4a5260",
  field: "#0b0e14",
  ember: "#ffa015",
  emberSoft: "#ffd58a",
  emberInk: "#1a1206",
  cyan: "#5ad7ff",
  live: "#4ade80",
  beg: "#ff5d6b",
} as const;

export const F = {
  display: "'Big Shoulders Display', sans-serif",
  body: "'Space Grotesk', system-ui, sans-serif",
  mono: "'JetBrains Mono', monospace",
} as const;

/** Per-good accent colors used for chips and goods text. */
export const RES_COLOR: Record<Good, string> = {
  wood: "#b58a4e",
  clay: "#d06a3f",
  reed: "#7fb069",
  stone: "#9aa5b1",
  grain: "#e0b94f",
  vegetable: "#6fae4e",
  food: "#5ad7ff",
  sheep: "#e8e6da",
  boar: "#c98b6b",
  cattle: "#d9c7a8",
};

export const panel: CSSProperties = {
  background: C.panel,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
};

/** Mono uppercase section heading ("ACTION BOARD", "ACTIVITY", …). */
export const sectionHeading: CSSProperties = {
  fontFamily: F.mono,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: C.muted,
  margin: "0 0 10px",
  fontWeight: 700,
};

export function stageOf(round: number): number {
  return round <= 4 ? 1 : round <= 7 ? 2 : round <= 9 ? 3 : round <= 11 ? 4 : round <= 13 ? 5 : 6;
}

export const STAGE_CHIPS: [string, number][] = [
  ["1–4", 1],
  ["5–7", 2],
  ["8–9", 3],
  ["10–11", 4],
  ["12–13", 5],
  ["14", 6],
];

export const HARVEST_AFTER = [4, 7, 9, 11, 13, 14];
export function nextHarvest(round: number): number | null {
  return HARVEST_AFTER.find((r) => r >= round) ?? null;
}

import { CSSProperties, ReactNode } from "react";
import { C, F, STAGE_CHIPS, stageOf, nextHarvest } from "./theme";

const mono = F.mono;

export interface HeaderTab {
  id: string;
  label: string;
  color?: string;
  /** Seat is driven by a non-human brain (shows the robot glyph). */
  ai?: boolean;
}

/** Small robot glyph marking a seat that a model/script is playing. */
export function RobotIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
      <circle cx="12" cy="3.5" r="1" fill="currentColor" stroke="none" />
      <path d="M12 4.5V8" />
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <circle cx="9.5" cy="13.5" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="13.5" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Shared top bar for both the live game and the replay viewer: logo, the
 * GLOBAL/FEED/per-player tab nav, the round/stage indicators, and a `rightSlot`
 * for the mode-specific controls (live turn chip + connection dot, or replay
 * playback controls).
 */
export function GameHeader({
  view,
  onSelect,
  tabs,
  round,
  finished,
  rightSlot,
  onTabContextMenu,
}: {
  view: string;
  onSelect: (id: string) => void;
  tabs: HeaderTab[];
  round: number;
  finished: boolean;
  rightSlot?: ReactNode;
  /** When provided, right-clicking a player tab opens the seat menu (live only). */
  onTabContextMenu?: (seat: number, e: React.MouseEvent) => void;
}) {
  const stageNow = stageOf(round);
  const nh = nextHarvest(round);
  return (
    <header style={{ flex: "none", display: "flex", alignItems: "center", gap: 16, padding: "2px 4px 10px", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, flex: "none" }}>
        <img src="art/logo-wordmark.png" alt="Agricogla" style={{ height: 30, width: "auto", display: "block", mixBlendMode: "lighten" }} />
      </div>

      <nav style={{ display: "flex", gap: 4, flex: "none" }}>
        {tabs.map((t) => {
          const active = view === t.id;
          const seatTab = t.id.startsWith("p");
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              onContextMenu={
                seatTab && onTabContextMenu
                  ? (e) => {
                      e.preventDefault();
                      onTabContextMenu(Number(t.id.slice(1)), e);
                    }
                  : undefined
              }
              title={seatTab && onTabContextMenu ? "right-click to control / observe this seat" : undefined}
              style={{
                background: active ? "#1c2230" : "transparent",
                border: `1px solid ${active ? t.color ?? C.ember : C.border}`,
                color: active ? C.ink : "#8b96a8",
                borderRadius: 6,
                padding: "5px 11px",
                fontFamily: mono,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.08em",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              {t.ai && <RobotIcon />}
              {t.label}
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted }}>Round</span>
          <span data-testid="round-indicator" data-round={round} style={{ fontFamily: F.display, fontWeight: 800, fontSize: 28, lineHeight: 1 }}>{round}/14</span>
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          {STAGE_CHIPS.map(([label, st]) => (
            <span
              key={st}
              style={{
                fontFamily: mono,
                fontSize: 8.5,
                fontWeight: 700,
                letterSpacing: "0.05em",
                padding: "3px 7px",
                borderRadius: 5,
                background: st === stageNow ? C.ember : st < stageNow ? C.field : C.panelBot,
                color: st === stageNow ? C.emberInk : st < stageNow ? C.faint : C.muted,
                border: `1px solid ${st === stageNow ? C.ember : C.border}`,
                boxShadow: st === stageNow ? "0 0 10px rgba(255,160,21,0.4)" : "none",
              }}
            >
              {label}
            </span>
          ))}
        </div>
        <span style={{ fontFamily: mono, fontSize: 11, padding: "5px 10px", borderRadius: 999, border: "1px solid #233140", color: C.cyan, whiteSpace: "nowrap" }}>
          {finished ? "GAME OVER" : nh ? `harvest after R${nh}` : ""}
        </span>
        {rightSlot}
      </div>
    </header>
  );
}

/** Shared button style for the small footer/header controls. */
export const chipBtn: CSSProperties = {
  fontFamily: mono,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
  padding: "6px 11px",
  borderRadius: 999,
  cursor: "pointer",
  background: "transparent",
  color: C.muted,
  border: `1px solid ${C.border}`,
};

import { MouseEvent } from "react";
import { C, F, HARVEST_AFTER } from "./theme";

export interface ScrubberProps {
  /** One entry per recorded round, in order. */
  frames: { round: number }[];
  sel: number;
  atLive: boolean;
  displayRound: number;
  msgCountByRound: Record<number, number>;
  onSeek: (i: number) => void;
  onLive: () => void;
}

const ctrlBtn = (extra?: object) => ({
  width: 32,
  height: 28,
  background: C.panelBot,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  color: C.inkDim,
  fontSize: 12,
  cursor: "pointer",
  ...extra,
});

export function Scrubber({ frames, sel, atLive, displayRound, msgCountByRound, onSeek, onLive }: ScrubberProps) {
  const last = Math.max(0, frames.length - 1);
  const pct = last > 0 ? (sel / last) * 100 : 0;
  const onTrack = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.round(((e.clientX - r.left) / r.width) * last));
  };
  return (
    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 14, padding: "4px 4px 2px" }}>
      <div style={{ display: "flex", gap: 5, flex: "none" }}>
        <button title="jump to round 1" onClick={() => onSeek(0)} style={ctrlBtn()}>⏮</button>
        <button title="previous round" onClick={() => onSeek(sel - 1)} style={ctrlBtn({ fontSize: 11 })}>◀</button>
        <button title="next round" onClick={() => onSeek(sel + 1)} style={ctrlBtn({ fontSize: 11 })}>▶</button>
        <button
          title="jump to live"
          onClick={onLive}
          style={{
            background: atLive ? "#13241a" : "transparent",
            border: `1px solid ${atLive ? "#2f6b45" : C.border}`,
            color: atLive ? C.live : C.muted,
            borderRadius: 6,
            padding: "5px 11px",
            fontFamily: F.mono,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          ⏭ LIVE
        </button>
      </div>
      <div onClick={onTrack} title="scrub through the rounds" style={{ position: "relative", flex: 1, height: 30, display: "flex", alignItems: "center", cursor: "pointer" }}>
        <div style={{ position: "absolute", left: 0, right: 0, height: 4, borderRadius: 2, background: C.borderSoft }} />
        <div style={{ position: "absolute", left: 0, height: 4, borderRadius: 2, width: `${pct}%`, background: "linear-gradient(90deg, #ffa015, #ffd58a)" }} />
        {frames.map((fr, i) => {
          const leftPct = last > 0 ? (i / last) * 100 : 0;
          const active = i <= sel;
          const harvest = HARVEST_AFTER.includes(fr.round);
          const dots = Math.min(6, msgCountByRound[fr.round] ?? 0);
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${leftPct}%`,
                top: 0,
                bottom: 0,
                transform: "translateX(-50%)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                pointerEvents: "none",
              }}
            >
              <span style={{ fontSize: 9, lineHeight: 1, color: harvest ? C.ember : "transparent", height: 10 }}>⌂</span>
              <div style={{ display: "flex", gap: 2, height: 5, alignItems: "center" }}>
                {Array.from({ length: dots }, (_, d) => (
                  <span key={d} style={{ width: 4, height: 4, borderRadius: "50%", background: active ? C.cyan : "#2c3548" }} />
                ))}
              </div>
              <span style={{ width: 2, height: 11, borderRadius: 1, background: i === sel ? C.ember : active ? "#5a6478" : "#2c3548" }} />
            </div>
          );
        })}
        <div style={{ position: "absolute", left: `${pct}%`, top: "50%", transform: "translate(-50%, -50%)", width: 13, height: 13, borderRadius: "50%", background: C.ember, border: "2px solid #1a1206", boxShadow: "0 0 10px rgba(255,160,21,0.6)", zIndex: 3 }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flex: "none" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "none", background: atLive ? C.live : C.cyan, boxShadow: `0 0 8px ${atLive ? C.live : C.cyan}` }} />
        <span style={{ fontFamily: F.mono, fontSize: 12, color: C.ink }}>round {displayRound}</span>
        <span style={{ fontFamily: F.mono, fontSize: 11, color: C.faint }}>/ 14</span>
      </div>
    </div>
  );
}

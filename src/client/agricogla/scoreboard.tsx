import { GameState } from "../../shared/engine/types";
import { C, F } from "./theme";

export function ScoreBoard({ state, onNewGame }: { state: GameState; onNewGame: () => void }) {
  if (!state.scores) return null;
  const scores = state.scores;
  const max = Math.max(...scores.map((s) => s.total));
  const winners = scores.filter((s) => s.total === max).map((s) => state.players[s.playerIdx]!.name);
  const winnerText = `${winners.join(" & ")} ${winners.length > 1 ? "tie" : "wins"} with ${max} points after 14 rounds.`;
  const categories = scores[0]!.categories.map((c) => c.label);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(4,6,10,0.82)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 660, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto", background: "linear-gradient(180deg, #1a2030, #11151d)", border: "1px solid #2c3548", borderRadius: 14, padding: "22px 26px", boxShadow: "0 30px 80px rgba(0,0,0,0.7)", display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 style={{ margin: 0, fontFamily: F.display, fontWeight: 900, fontSize: 30, letterSpacing: "0.05em", textTransform: "uppercase", background: "linear-gradient(90deg, #ffffff, #ffa015)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
          Final scoring
        </h3>
        <p style={{ margin: 0, fontSize: 14, color: C.inkDim }}>{winnerText}</p>
        <div style={{ display: "grid", gridTemplateColumns: `1.6fr repeat(${scores.length}, 1fr)`, border: `1px solid ${C.border}`, borderRadius: 9, overflow: "hidden" }}>
          <div style={{ padding: "8px 12px", background: C.field, fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.muted }}>Category</div>
          {scores.map((s) => (
            <div key={s.playerIdx} style={{ padding: "8px 10px", background: C.field, fontFamily: F.mono, fontSize: 10, fontWeight: 700, color: state.players[s.playerIdx]!.color, textAlign: "right", letterSpacing: "0.05em" }}>
              {state.players[s.playerIdx]!.name}
            </div>
          ))}
          {categories.map((label, ci) => (
            <Row key={label} label={label} cells={scores.map((s) => s.categories[ci]!.points)} colors={scores.map((s) => state.players[s.playerIdx]!.color)} />
          ))}
          <Row label="TOTAL" total cells={scores.map((s) => s.total)} max={max} colors={scores.map((s) => state.players[s.playerIdx]!.color)} />
        </div>
        <button onClick={onNewGame} style={{ alignSelf: "center", background: C.ember, color: C.emberInk, border: "none", borderRadius: 8, padding: "10px 26px", fontWeight: 800, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}>
          Play again
        </button>
      </div>
    </div>
  );
}

function Row({ label, cells, total, max, colors: _colors }: { label: string; cells: number[]; total?: boolean; max?: number; colors: string[] }) {
  return (
    <>
      <div style={{ padding: total ? "9px 12px" : "5px 12px", fontSize: total ? 13 : 12, fontWeight: total ? 800 : 400, color: total ? C.ember : C.inkDim, borderTop: `1px solid ${C.borderSoft}`, background: total ? C.field : "transparent" }}>
        {label}
      </div>
      {cells.map((v, i) => {
        const win = total && v === max;
        return (
          <div key={i} style={{ padding: total ? "9px 10px" : "5px 10px", fontFamily: F.mono, fontSize: total ? 13.5 : 12, fontWeight: total ? 800 : 500, textAlign: "right", color: win ? C.ember : total ? C.ink : C.inkDim, borderTop: `1px solid ${C.borderSoft}`, background: total ? C.field : "transparent" }}>
            {v}
          </div>
        );
      })}
    </>
  );
}

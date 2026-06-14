import { scorePlayer } from "../../shared/engine/scoring";
import { GameState, Good, PlayerState } from "../../shared/engine/types";
import { GOOD_LABELS } from "../icons";
import { Farm } from "../Farm";
import { C, F, RES_COLOR } from "./theme";

function Chip({ good, val, color }: { good: Good; val: number; color: string }) {
  return (
    <span
      title={GOOD_LABELS[good]}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontFamily: F.mono,
        fontSize: 9.5,
        fontWeight: 600,
        padding: "2px 6px",
        borderRadius: 999,
        background: C.field,
        border: `1px solid ${C.border}`,
        color,
      }}
    >
      <img src={`art/token-${good}.png`} alt="" style={{ height: 13, width: 13, objectFit: "contain" }} />
      {val}
    </span>
  );
}

/** Icon + label pill for non-good stats (family, house, begging). */
function Stat({ src, label, title }: { src?: string; label: string; title: string }) {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontFamily: F.mono,
        fontSize: 9.5,
        fontWeight: 600,
        padding: "2px 6px",
        borderRadius: 999,
        background: C.field,
        border: `1px solid ${C.border}`,
        color: C.inkDim,
      }}
    >
      {src && <img src={src} alt="" style={{ height: 13, width: 13, objectFit: "contain" }} />}
      {label}
    </span>
  );
}

export function MiniFarm({ state, player }: { state: GameState; player: PlayerState }) {
  const score = scorePlayer(state, player).total;
  const isTurn = state.phase === "work" && state.currentPlayer === player.idx;
  const newborn = player.family.filter((m) => m.bornRound === state.round).length;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        background: C.panel,
        border: `1px solid ${isTurn ? player.color : C.border}`,
        borderRadius: 10,
        padding: "11px 13px",
        boxShadow: isTurn ? `0 0 16px ${player.color}33` : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{ width: 11, height: 11, borderRadius: 3, background: player.color, boxShadow: `0 0 8px ${player.color}`, flex: "none" }}
        />
        <span style={{ fontWeight: 700, fontSize: 14 }}>{player.name}</span>
        {isTurn && (
          <span style={{ fontFamily: F.mono, fontSize: 8, letterSpacing: "0.1em", color: C.ember, animation: "pulseGlow 1.4s ease-in-out infinite" }}>
            PLACING
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: F.mono, fontSize: 12, color: C.ember }}>{score} pts</span>
      </div>
      <Farm player={player} fit />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        <Chip good="wood" val={player.resources.wood} color={RES_COLOR.wood} />
        <Chip good="clay" val={player.resources.clay} color={RES_COLOR.clay} />
        <Chip good="reed" val={player.resources.reed} color={RES_COLOR.reed} />
        <Chip good="stone" val={player.resources.stone} color={RES_COLOR.stone} />
        <Chip good="grain" val={player.resources.grain} color={RES_COLOR.grain} />
        <Chip good="vegetable" val={player.resources.vegetable} color={RES_COLOR.vegetable} />
        <Chip good="food" val={player.resources.food} color={RES_COLOR.food} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        <Stat src="art/token-family.png" label={`${player.family.length}${newborn ? `+${newborn}` : ""}`} title="Family members" />
        <Stat src="art/act-renovate.png" label={player.houseMaterial} title="House material" />
        <Chip good="sheep" val={player.animals.sheep} color={RES_COLOR.sheep} />
        <Chip good="boar" val={player.animals.boar} color={RES_COLOR.boar} />
        <Chip good="cattle" val={player.animals.cattle} color={RES_COLOR.cattle} />
        {player.beggingCards > 0 && <Stat label={`begging ${player.beggingCards}`} title="Begging cards" />}
      </div>
    </div>
  );
}

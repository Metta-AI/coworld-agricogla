import { computePastures } from "../../shared/engine/farmyard";
import { scorePlayer } from "../../shared/engine/scoring";
import { GameState, PlayerState } from "../../shared/engine/types";
import { C, F, RES_COLOR } from "./theme";

const ROOM_BG: Record<string, string> = { wood: "#7c5530", clay: "#a25533", stone: "#667085" };

interface Tile {
  glyph: string;
  bg: string;
  dashed: boolean;
}

function tilesFor(player: PlayerState): Tile[] {
  const { pastureCells } = computePastures(player.spaces, player.fences);
  return player.spaces.map((sp, i) => {
    if (sp.kind === "room") return { glyph: "R", bg: ROOM_BG[player.houseMaterial]!, dashed: false };
    if (sp.kind === "field") return { glyph: "F", bg: "#6b4f28", dashed: false };
    if (pastureCells.has(i)) return { glyph: "P", bg: "#1f4a2c", dashed: true };
    if (sp.stable) return { glyph: "S", bg: "#4a3d27", dashed: false };
    return { glyph: "", bg: "#12170f", dashed: false };
  });
}

function Chip({ label, val, color }: { label: string; val: number; color: string }) {
  return (
    <span
      style={{
        fontFamily: F.mono,
        fontSize: 9.5,
        fontWeight: 600,
        padding: "2px 7px",
        borderRadius: 999,
        background: C.field,
        border: `1px solid ${C.border}`,
        color,
      }}
    >
      {label} {val}
    </span>
  );
}

export function MiniFarm({ state, player }: { state: GameState; player: PlayerState }) {
  const score = scorePlayer(state, player).total;
  const isTurn = state.phase === "work" && state.currentPlayer === player.idx;
  const newborn = player.family.filter((m) => m.bornRound === state.round).length;
  const tiles = tilesFor(player);
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 3 }}>
        {tiles.map((t, i) => (
          <span
            key={i}
            style={{
              aspectRatio: "1",
              borderRadius: 3,
              background: t.bg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: t.dashed ? "1px dashed #3f7d52" : "1px solid rgba(255,255,255,0.07)",
              fontFamily: F.mono,
              fontSize: 8,
              color: "rgba(255,255,255,0.55)",
              fontWeight: 700,
            }}
          >
            {t.glyph}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        <Chip label="WD" val={player.resources.wood} color={RES_COLOR.wood} />
        <Chip label="CL" val={player.resources.clay} color={RES_COLOR.clay} />
        <Chip label="RD" val={player.resources.reed} color={RES_COLOR.reed} />
        <Chip label="ST" val={player.resources.stone} color={RES_COLOR.stone} />
        <Chip label="GR" val={player.resources.grain} color={RES_COLOR.grain} />
        <Chip label="VG" val={player.resources.vegetable} color={RES_COLOR.vegetable} />
        <Chip label="FOOD" val={player.resources.food} color={RES_COLOR.food} />
      </div>
      <div style={{ fontFamily: F.mono, fontSize: 9.5, color: C.muted, letterSpacing: "0.04em" }}>
        {`fam ${player.family.length}${newborn ? `+${newborn}` : ""} · ${player.houseMaterial} house · sheep ${player.animals.sheep} · boar ${player.animals.boar} · cattle ${player.animals.cattle}${player.beggingCards ? ` · begging ${player.beggingCards}` : ""}`}
      </div>
    </div>
  );
}

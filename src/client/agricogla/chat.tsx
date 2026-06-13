import { useState } from "react";
import { PlayerState } from "../../shared/engine/types";
import { ChatMessage } from "../../shared/protocol";
import { C, F } from "./theme";

function nameOf(players: PlayerState[], idx: number): string {
  return players[idx]?.name ?? `P${idx}`;
}

export function Message({
  m,
  players,
  mySeat,
  textSize = 12,
}: {
  m: ChatMessage;
  players: PlayerState[];
  mySeat: number | null;
  textSize?: number;
}) {
  const dm = m.to !== null;
  const toLabel =
    m.to === null ? "to table" : m.to === mySeat ? "to you" : `→ ${nameOf(players, m.to)}`;
  return (
    <div
      style={{
        display: "flex",
        gap: 7,
        alignItems: "baseline",
        padding: "5px 8px",
        borderRadius: 6,
        borderLeft: `2px solid ${dm ? C.cyan : "transparent"}`,
        background: dm ? "rgba(90,215,255,0.05)" : "transparent",
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 700, color: players[m.from]?.color ?? C.ink, flex: "none" }}>
        {nameOf(players, m.from)}
      </span>
      <span style={{ fontSize: 9.5, color: C.muted, flex: "none" }}>{toLabel}</span>
      <span style={{ fontSize: textSize, color: C.inkSoft, lineHeight: 1.45 }}>{m.text}</span>
    </div>
  );
}

export function MessageList({
  messages,
  players,
  mySeat,
  textSize,
  empty,
}: {
  messages: ChatMessage[];
  players: PlayerState[];
  mySeat: number | null;
  textSize?: number;
  empty?: string;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
      {messages.map((m) => (
        <Message key={m.seq} m={m} players={players} mySeat={mySeat} textSize={textSize} />
      ))}
      {messages.length === 0 && empty && (
        <div style={{ fontSize: 12, color: C.faint, padding: "4px 2px" }}>{empty}</div>
      )}
    </div>
  );
}

/** Public + per-opponent DM composer. `from` is the seat you play. */
export function Composer({
  players,
  from,
  onSend,
  prefix,
}: {
  players: PlayerState[];
  from: number;
  onSend: (to: number | null, text: string) => void;
  prefix?: string;
}) {
  const [draft, setDraft] = useState("");
  const [to, setTo] = useState<number | null>(null);
  const targets: { id: number | null; label: string }[] = [
    { id: null, label: "ALL" },
    ...players.filter((p) => p.idx !== from).map((p) => ({ id: p.idx, label: p.name.toUpperCase() })),
  ];
  const send = () => {
    if (!draft.trim()) return;
    onSend(to, draft);
    setDraft("");
  };
  const placeholder =
    to === null
      ? "Say something to the whole table…"
      : `Private message to ${nameOf(players, to)}… (observers can see DMs)`;
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        flexDirection: "column",
        gap: 7,
        paddingTop: 10,
        borderTop: `1px solid ${C.border}`,
        marginTop: 8,
      }}
    >
      <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", color: C.muted, textTransform: "uppercase" }}>
          {prefix ?? "to"}
        </span>
        {targets.map((t) => {
          const active = to === t.id;
          return (
            <button
              key={t.id ?? "all"}
              onClick={() => setTo(t.id)}
              style={{
                background: active ? "#1c2230" : "transparent",
                border: `1px solid ${active ? (t.id === null ? C.ember : C.cyan) : C.border}`,
                color: active ? C.ink : C.muted,
                borderRadius: 999,
                padding: "3px 10px",
                fontFamily: F.mono,
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.06em",
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          placeholder={placeholder}
          style={{
            flex: 1,
            minWidth: 0,
            background: C.field,
            border: `1px solid ${C.border}`,
            borderRadius: 7,
            padding: "8px 11px",
            color: C.ink,
            fontSize: 12.5,
          }}
        />
        <button
          onClick={send}
          style={{
            background: C.ember,
            color: C.emberInk,
            border: "none",
            borderRadius: 7,
            padding: "8px 16px",
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

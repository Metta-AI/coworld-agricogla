import { CSSProperties, useEffect, useState } from "react";
import { ServerStatus } from "../../shared/protocol";
import { C, F } from "./theme";

/** Seat colours by index, matching the engine's player palette. */
const LOBBY_COLORS = ["#a855f7", "#4ade80", "#5ad7ff", "#ff5d6b"];

const shell: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 18,
  padding: "0 20px",
  background:
    "radial-gradient(1200px 700px at 50% -10%, rgba(16,22,34,0.82) 0%, rgba(7,9,13,0.92) 55%), url(art/texture-stage.png) center/cover no-repeat, #07090d",
  color: C.ink,
  fontFamily: F.body,
};

const heading: CSSProperties = {
  fontFamily: F.display,
  fontWeight: 800,
  fontSize: 22,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  margin: 0,
};

const card: CSSProperties = {
  background: C.panel,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: "22px 26px",
  width: 430,
  maxWidth: "100%",
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

function btn(kind: "primary" | "ghost" | "disabled"): CSSProperties {
  const base: CSSProperties = {
    fontFamily: F.mono,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    padding: "11px 14px",
    borderRadius: 999,
    cursor: kind === "disabled" ? "default" : "pointer",
    flex: 1,
  };
  if (kind === "primary") return { ...base, background: C.ember, color: C.emberInk, border: `1px solid ${C.ember}` };
  if (kind === "ghost") return { ...base, background: C.field, color: C.ink, border: `1px solid ${C.border}` };
  return { ...base, background: C.field, color: C.faint, border: `1px solid ${C.border}`, opacity: 0.5 };
}

function Wordmark() {
  return <img src="art/logo-wordmark.png" alt="Agricogla" style={{ height: 44, width: "auto", mixBlendMode: "lighten" }} />;
}

/** Pre-game lobby shown on the table view until play starts. */
export function Lobby({
  status,
  onAddBot,
  onStart,
  onRemove,
}: {
  status: ServerStatus;
  onAddBot: () => void;
  onStart: () => void;
  onRemove: (idx: number) => void;
}) {
  const roster = status.roster;
  const full = roster.length >= status.maxPlayers;
  const joinUrl = new URL("join", document.baseURI).href;
  const [copied, setCopied] = useState(false);
  const copyJoin = () => {
    navigator.clipboard.writeText(joinUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div style={shell}>
      <Wordmark />
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <h2 style={{ ...heading, flex: 1 }}>Lobby</h2>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: C.muted }}>
            {roster.length}/{status.maxPlayers}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {roster.map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", background: C.field, border: `1px solid ${C.border}`, borderRadius: 8 }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: LOBBY_COLORS[i % 4], boxShadow: `0 0 8px ${LOBBY_COLORS[i % 4]}`, flex: "none" }} />
              <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>{r.name}</span>
              <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", color: r.controller === "human" ? C.cyan : C.ember }}>
                {r.controller === "human" ? "HUMAN" : "BOT"}
              </span>
              <button
                onClick={() => onRemove(i)}
                title="Remove from lobby"
                aria-label={`remove ${r.name}`}
                style={{ flex: "none", width: 20, height: 20, borderRadius: 6, background: "transparent", border: `1px solid ${C.border}`, color: C.muted, cursor: "pointer", fontSize: 13, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                ×
              </button>
            </div>
          ))}
          {roster.length === 0 && (
            <div style={{ fontSize: 13, color: C.muted, padding: "10px 2px" }}>
              Waiting for players — add a bot or share the join link.
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onAddBot} disabled={full} style={btn(full ? "disabled" : "ghost")}>
            + Add Bot
          </button>
          <button onClick={onStart} disabled={roster.length === 0} style={btn(roster.length === 0 ? "disabled" : "primary")}>
            Start game ▶
          </button>
        </div>
        <button
          onClick={copyJoin}
          title="Click to copy"
          style={{ fontFamily: F.mono, fontSize: 11, color: C.muted, background: "none", border: "none", borderTop: `1px solid ${C.borderSoft}`, paddingTop: 12, textAlign: "left", cursor: "pointer", width: "100%" }}
        >
          Others join at <span style={{ color: copied ? C.live : C.cyan, textDecoration: "underline" }}>{joinUrl}</span>
          {copied ? <span style={{ color: C.live }}> · copied!</span> : <span style={{ color: C.faint }}> · click to copy</span>}
        </button>
      </div>
    </div>
  );
}

/** Standalone /join page: enter a name to claim a seat (or spectate if closed). */
export function JoinPage() {
  const [name, setName] = useState("");
  const [info, setInfo] = useState<{ started: boolean; players: number; maxPlayers: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    fetch(new URL("api/status", document.baseURI).href)
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => {});
  useEffect(() => {
    refresh();
  }, []);

  const blocked = info ? info.started || info.players >= info.maxPlayers : false;
  const spectate = () => {
    location.href = document.baseURI;
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(new URL("api/join", document.baseURI).href, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        const { playerIdx } = await res.json();
        location.href = new URL(`player/${playerIdx}`, document.baseURI).href;
        return;
      }
      const body = (await res.json().catch(() => ({ error: "could not join" }))) as { error?: string };
      setError(body.error ?? "could not join");
      refresh();
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  };

  return (
    <div style={shell}>
      <Wordmark />
      <div style={card}>
        {blocked ? (
          <>
            <h2 style={heading}>Can’t join</h2>
            <p style={{ fontSize: 14, color: C.inkDim, margin: 0 }}>
              {info?.started ? "The game is already in progress." : "The table is full."}
            </p>
            <button onClick={spectate} style={btn("primary")}>
              Spectate ▶
            </button>
          </>
        ) : (
          <>
            <h2 style={heading}>Join the table</h2>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="your name"
              maxLength={40}
              style={{ fontFamily: F.body, fontSize: 15, padding: "11px 13px", borderRadius: 9, background: C.field, border: `1px solid ${C.border}`, color: C.ink }}
            />
            {error && <div style={{ color: C.beg, fontSize: 13 }}>⚠ {error}</div>}
            <button onClick={() => void submit()} disabled={!name.trim() || busy} style={btn(!name.trim() || busy ? "disabled" : "primary")}>
              {busy ? "Joining…" : "Join game"}
            </button>
            {info && (
              <div style={{ fontFamily: F.mono, fontSize: 11, color: C.muted }}>
                {info.players}/{info.maxPlayers} seats filled
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

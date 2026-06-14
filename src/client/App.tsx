import { CSSProperties, useEffect, useRef, useState } from "react";
import { computeAutoFeed } from "../shared/engine/apply";
import { legalActions, playerChoices } from "../shared/engine/legal";
import { Placement } from "../shared/engine/placements";
import { GameState } from "../shared/engine/types";
import { Controller, DEFAULT_BEDROCK_MODEL } from "../shared/protocol";
import { FeedDialog, PlacementDialog } from "./Dialogs";
import { GameSocket } from "./net";
import { ReplayApp } from "./Replay";
import { GlobalView, FeedView, PlayerView } from "./agricogla/views";
import { Lobby, JoinPage } from "./agricogla/lobby";
import { Scrubber } from "./agricogla/scrubber";
import { ScoreBoard } from "./agricogla/scoreboard";
import { C, F, nextHarvest, STAGE_CHIPS, stageOf } from "./agricogla/theme";

function routeSeat(): { playerIdx: number | null; token?: string } {
  // Match by path suffix: behind the Observatory hosted proxy the pathname is
  // prefixed (.../sessions/<id>/proxy/client/player), so exact matches fail.
  const match = /\/player\/(\d+)\/?$/.exec(location.pathname);
  if (match) return { playerIdx: Number(match[1]) };
  if (location.pathname.endsWith("/client/player")) {
    const params = new URLSearchParams(location.search);
    const slot = Number(params.get("slot"));
    if (Number.isInteger(slot) && slot >= 0) {
      return { playerIdx: slot, token: params.get("token") ?? undefined };
    }
  }
  return { playerIdx: null };
}

export function App() {
  if (location.pathname.endsWith("/client/replay")) return <ReplayApp />;
  if (location.pathname.endsWith("/join")) return <JoinPage />;
  return <GameApp />;
}

interface Frame {
  round: number;
  seed: number;
  state: GameState;
}

const mono = F.mono;

/** Small robot glyph marking a seat that the autopilot model is playing. */
function RobotIcon() {
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

function GameApp() {
  const [, setTick] = useState(0);
  const seat = routeSeat();
  // Seat is URL-derived initially, but can be re-claimed live via the seat menu.
  const [mySeat, setMySeat] = useState<number | null>(seat.playerIdx);
  const socketRef = useRef<GameSocket | null>(null);
  if (!socketRef.current) {
    socketRef.current = new GameSocket(seat.playerIdx, () => setTick((t) => t + 1), seat.token);
  }
  const socket = socketRef.current;
  useEffect(() => {
    socket.connect();
  }, [socket]);

  const [view, setView] = useState<string>(mySeat !== null ? `p${mySeat}` : "global");
  const [dialogSpace, setDialogSpace] = useState<string | null>(null);
  const [histIndex, setHistIndex] = useState<number | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  // Final-scoring modal can be dismissed to explore the timeline, then reopened.
  const [scoreClosed, setScoreClosed] = useState(false);
  // Seat-takeover menu (right-click a player tab). prevController remembers each
  // seat's controller before takeover so "observe" hands it back to the same AI.
  const prevControllerRef = useRef<Record<number, Controller>>({});
  const [seatMenu, setSeatMenu] = useState<{ seat: number; x: number; y: number } | null>(null);

  const { state, status, prompts, chat, lastError, connected } = socket.feed;

  // Accumulate one snapshot per round boundary for the scrubber.
  useEffect(() => {
    if (!state) return;
    setFrames((prev) => {
      if (prev.length && prev[0]!.seed !== state.seed) {
        return [{ round: state.round, seed: state.seed, state }];
      }
      const last = prev[prev.length - 1];
      if (!last || state.round > last.round) {
        return [...prev, { round: state.round, seed: state.seed, state }];
      }
      return prev;
    });
  }, [state]);

  const lastIdx = Math.max(0, frames.length - 1);
  const seekTo = (i: number) => {
    const clamped = Math.max(0, Math.min(i, lastIdx));
    setHistIndex(clamped >= lastIdx ? null : clamped);
  };

  // Keyboard scrubbing (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (frames.length < 2) return;
      const cur = histIndex == null ? frames.length - 1 : histIndex;
      seekTo(cur + (e.key === "ArrowLeft" ? -1 : 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [frames.length, histIndex]);

  if (!status) {
    return (
      <div className="loading">
        <h1>⌂ Agricogla</h1>
        <p>{connected ? "waiting for the table…" : "connecting…"}</p>
      </div>
    );
  }
  // Pre-game lobby: collect players (cogs + joins) until someone hits Start.
  if (!status.started) {
    return <Lobby status={status} onAddBot={() => socket.addBot()} onStart={() => socket.resume()} />;
  }
  if (!state) {
    return (
      <div className="loading">
        <h1>⌂ Agricogla</h1>
        <p>{connected ? "waiting for the table…" : "connecting…"}</p>
      </div>
    );
  }

  const sel = histIndex == null ? lastIdx : Math.min(Math.max(histIndex, 0), lastIdx);
  const atLive = histIndex == null || sel >= lastIdx;
  const reviewing = !atLive;
  const viewState = atLive ? state : (frames[sel]?.state ?? state);
  const displayRound = atLive ? state.round : (frames[sel]?.round ?? state.round);

  const finished = status.finished;
  const iAmHuman = mySeat !== null && status.controllers[mySeat] === "human";
  const myTurn = iAmHuman && state.phase === "work" && state.currentPlayer === mySeat && !finished;
  const myFeed = iAmHuman && state.phase === "feeding" && state.toFeed.includes(mySeat!) && !finished;
  const options = myTurn ? legalActions(state, mySeat!) : null;
  const choices = mySeat !== null && (myTurn || myFeed) ? playerChoices(state, mySeat) : null;

  const visibleChat = chat.filter((m) => m.round <= displayRound);
  const logItems = state.log.filter((l) => l.round <= displayRound);
  const msgCountByRound: Record<number, number> = {};
  for (const m of chat) msgCountByRound[m.round] = (msgCountByRound[m.round] ?? 0) + 1;

  const autoOn = mySeat !== null && status.controllers[mySeat] !== "human";
  const thinking = status.thinking === mySeat && mySeat !== null;

  const submitPlacement = (placement: Placement) => {
    socket.place(placement);
    setDialogSpace(null);
  };
  const sendChat = (to: number | null, text: string) => socket.sendChat(to, text);

  // ---- seat mode (right-click a player tab): observe / control / autopilot ----
  // Leaving a seat we were manually driving hands it back to an AI so the game
  // never stalls on an empty human seat.
  const releasePriorSeat = (next: number | null) => {
    if (mySeat !== null && mySeat !== next && status.controllers[mySeat] === "human") {
      socket.setController(mySeat, prevControllerRef.current[mySeat] ?? "llm");
    }
  };
  const takeControl = (idx: number) => {
    releasePriorSeat(idx);
    prevControllerRef.current[idx] = status.controllers[idx] ?? "scripted";
    socket.setController(idx, "human");
    socket.claimSeat(idx);
    setMySeat(idx);
    setView(`p${idx}`);
  };
  const autopilotSeat = (idx: number) => {
    releasePriorSeat(idx);
    // Keep a scripted brain if it already has one; otherwise hand it to an LLM.
    socket.setController(idx, status.controllers[idx] === "scripted" ? "scripted" : "llm");
    socket.claimSeat(idx);
    setMySeat(idx);
    setView(`p${idx}`);
  };
  const observeSeat = (idx: number) => {
    if (mySeat === idx) {
      if (status.controllers[idx] === "human") {
        socket.setController(idx, prevControllerRef.current[idx] ?? "llm");
      }
      socket.claimSeat(null);
      setMySeat(null);
    }
    setView(`p${idx}`);
  };

  // ---- header bits ----
  const tabs = [
    { id: "global", label: "GLOBAL", color: undefined as string | undefined, ai: false },
    { id: "feed", label: "FEED", color: undefined as string | undefined, ai: false },
    ...state.players.map((p) => ({
      id: `p${p.idx}`,
      label: p.idx === mySeat ? "YOUR FARM" : p.name.toUpperCase(),
      color: p.color as string | undefined,
      // Seat is on autopilot — any non-human brain (scripted or an LLM model).
      ai: status.controllers[p.idx] !== "human" && status.controllers[p.idx] !== "remote",
    })),
  ];
  const stageNow = stageOf(state.round);
  const nh = nextHarvest(state.round);
  const curName = state.players[state.currentPlayer]?.name ?? "—";

  const turnChip = (() => {
    if (finished) return { text: scoreClosed ? "▦ FINAL SCORES" : "FINAL SCORES", bg: "transparent", color: C.inkDim, border: C.border, pulse: false };
    if (reviewing)
      return { text: `◀ REVIEWING R${displayRound} · back to live`, bg: "rgba(90,215,255,0.12)", color: C.cyan, border: "#3a6b80", pulse: false };
    if (myTurn) return { text: "● YOUR TURN — place a worker", bg: C.ember, color: C.emberInk, border: C.ember, pulse: true };
    if (state.phase === "feeding") return { text: "HARVEST — feeding", bg: "transparent", color: C.ember, border: "#6a5524", pulse: false };
    return { text: `placing: ${curName}`, bg: "transparent", color: C.inkDim, border: C.border, pulse: false };
  })();
  const onTurnChip = () => {
    if (finished) return setScoreClosed((c) => !c);
    if (reviewing) return setHistIndex(null);
    setView(myTurn && mySeat !== null ? `p${mySeat}` : "global");
  };

  const appStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "12px 16px 8px",
    overflow: "hidden",
    background:
      "radial-gradient(1200px 700px at 50% -10%, rgba(16,22,34,0.82) 0%, rgba(7,9,13,0.92) 55%), url(art/texture-stage.png) center/cover no-repeat, #07090d",
    color: C.ink,
    fontFamily: F.body,
    fontSize: 14,
  };

  return (
    <div style={appStyle}>
      {/* ===== header ===== */}
      <header style={{ flex: "none", display: "flex", alignItems: "center", gap: 16, padding: "2px 4px 10px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flex: "none" }}>
          <img src="art/logo-wordmark.png" alt="Agricogla" style={{ height: 30, width: "auto", display: "block", mixBlendMode: "lighten" }} />
        </div>

        <nav style={{ display: "flex", gap: 4, flex: "none" }}>
          {tabs.map((t) => {
            const active = view === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                onContextMenu={
                  t.id.startsWith("p") && !status.readOnly
                    ? (e) => {
                        e.preventDefault();
                        setSeatMenu({ seat: Number(t.id.slice(1)), x: e.clientX, y: e.clientY });
                      }
                    : undefined
                }
                title={t.id.startsWith("p") && !status.readOnly ? "right-click to control / observe this seat" : undefined}
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
            <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: 28, lineHeight: 1 }}>{state.round}/14</span>
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
          {autoOn && (
            <span
              style={{
                fontFamily: mono,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.07em",
                padding: "5px 10px",
                borderRadius: 999,
                whiteSpace: "nowrap",
                color: thinking ? C.emberInk : C.emberSoft,
                background: thinking ? C.ember : "rgba(255,160,21,0.12)",
                border: `1px solid ${thinking ? C.ember : "#6a5524"}`,
                animation: thinking ? "pulseGlow 1.2s ease-in-out infinite" : "none",
              }}
            >
              {thinking ? "AUTO · THINKING" : "AUTOPILOT"}
            </span>
          )}
          <button
            onClick={onTurnChip}
            style={{
              fontFamily: mono,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.05em",
              whiteSpace: "nowrap",
              padding: "6px 13px",
              borderRadius: 999,
              cursor: "pointer",
              background: turnChip.bg,
              color: turnChip.color,
              border: `1px solid ${turnChip.border}`,
              animation: turnChip.pulse ? "pulseGlow 1.6s ease-in-out infinite" : "none",
              boxShadow: turnChip.pulse ? "0 0 16px rgba(255,160,21,0.45)" : "none",
            }}
          >
            {turnChip.text}
          </button>
          <span title={connected ? "connected" : "reconnecting"} style={{ width: 9, height: 9, borderRadius: "50%", background: connected ? C.live : C.beg, boxShadow: connected ? `0 0 7px ${C.live}` : "none" }} />
        </div>
      </header>

      {lastError && (
        <div onClick={() => socket.clearError()} style={{ flex: "none", background: "rgba(255,93,107,0.14)", border: "1px solid rgba(255,93,107,0.5)", color: C.beg, padding: "7px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          ⚠ {lastError} (click to dismiss)
        </div>
      )}

      {/* ===== view ===== */}
      {view === "global" && <GlobalView state={viewState} messages={visibleChat} log={logItems} mySeat={mySeat} />}
      {view === "feed" && <FeedView state={viewState} messages={visibleChat} log={logItems} mySeat={mySeat} onSend={sendChat} />}
      {view.startsWith("p") && (
        <PlayerView
          viewState={viewState}
          liveState={state}
          viewSeat={Number(view.slice(1))}
          mySeat={mySeat}
          finished={finished}
          reviewing={reviewing}
          options={options}
          messages={visibleChat.filter((m) => {
            const vs = Number(view.slice(1));
            return m.to === null || m.from === vs || m.to === vs;
          })}
          onPick={setDialogSpace}
          onSend={sendChat}
          autoOn={autoOn}
          thinking={thinking}
          guidance={mySeat !== null ? status.guidance[mySeat] ?? "" : ""}
          brain={
            mySeat !== null && status.controllers[mySeat] === "scripted"
              ? "scripted"
              : mySeat !== null
                ? status.models?.[mySeat] ?? DEFAULT_BEDROCK_MODEL
                : DEFAULT_BEDROCK_MODEL
          }
          prompts={prompts.filter((p) => p.playerIdx === Number(view.slice(1)))}
          onToggleAuto={() => mySeat !== null && socket.setController(mySeat, autoOn ? "human" : "llm")}
          onGuidance={(text) => mySeat !== null && socket.setGuidance(mySeat, text)}
          onSetBrain={(b) => {
            if (mySeat === null) return;
            if (b === "scripted") socket.setController(mySeat, "scripted");
            else {
              socket.setController(mySeat, "llm");
              socket.setModel(mySeat, b);
            }
          }}
        />
      )}

      {/* ===== scrubber ===== */}
      {frames.length > 1 && (
        <Scrubber
          frames={frames}
          sel={sel}
          atLive={atLive}
          displayRound={displayRound}
          msgCountByRound={msgCountByRound}
          onSeek={seekTo}
          onLive={() => setHistIndex(null)}
        />
      )}

      {/* ===== footer ===== */}
      <footer style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "6px 4px 2px", borderTop: `1px solid ${C.borderSoft}` }}>
        <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.05em", color: C.faint }}>
          Full Agricogla rules · observers see DMs · flip Autopilot in your farm to let the model play your seat · scrub the timeline to replay past rounds
        </span>
        <span style={{ flex: 1 }} />
        {!status.readOnly && (
          <>
            <button onClick={() => (status.paused ? socket.resume() : socket.pause())} style={footBtn}>
              {status.paused ? "▶ resume" : "⏸ pause"}
            </button>
            <button onClick={() => { setScoreClosed(false); socket.reset(); }} title="new game, next seed" style={footBtn}>
              ↻ new game
            </button>
          </>
        )}
      </footer>

      {/* ===== modals ===== */}
      {myTurn && dialogSpace && choices && (
        <PlacementDialog
          spaceId={dialogSpace}
          state={state}
          playerIdx={mySeat!}
          choices={choices}
          onSubmit={submitPlacement}
          onCancel={() => setDialogSpace(null)}
        />
      )}
      {myFeed && choices && (
        <FeedDialog
          state={state}
          playerIdx={mySeat!}
          choices={choices}
          onSubmit={(conversions) => socket.feedDecision({ conversions })}
          onAuto={() => socket.feedDecision(computeAutoFeed(state, mySeat!))}
        />
      )}
      {finished && !scoreClosed && (
        <ScoreBoard
          state={state}
          onNewGame={() => {
            setScoreClosed(false);
            socket.reset();
          }}
          onClose={() => setScoreClosed(true)}
        />
      )}

      {/* ===== seat control / observe menu ===== */}
      {seatMenu &&
        (() => {
          const idx = seatMenu.seat;
          const name = state.players[idx]?.name ?? `Seat ${idx}`;
          const mode = mySeat === idx ? (status.controllers[idx] === "human" ? "control" : "autopilot") : "observe";
          const itemStyle: CSSProperties = {
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            textAlign: "left",
            background: "transparent",
            border: "none",
            color: C.ink,
            fontFamily: mono,
            fontSize: 11.5,
            letterSpacing: "0.03em",
            padding: "8px 13px",
            cursor: "pointer",
            whiteSpace: "nowrap",
          };
          const dot = (active: boolean) => (
            <span style={{ width: 9, flex: "none", color: C.ember }}>{active ? "●" : ""}</span>
          );
          return (
            <>
              <div
                onClick={() => setSeatMenu(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSeatMenu(null);
                }}
                style={{ position: "fixed", inset: 0, zIndex: 99 }}
              />
              <div
                style={{
                  position: "fixed",
                  left: Math.min(seatMenu.x, window.innerWidth - 200),
                  top: seatMenu.y,
                  zIndex: 100,
                  minWidth: 176,
                  background: C.panel,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  boxShadow: "0 12px 34px rgba(0,0,0,0.6)",
                  overflow: "hidden",
                  padding: "4px 0",
                }}
              >
                <div style={{ padding: "6px 13px 7px", fontFamily: mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.muted, borderBottom: `1px solid ${C.borderSoft}` }}>
                  {name}
                </div>
                <button style={itemStyle} onClick={() => { observeSeat(idx); setSeatMenu(null); }}>
                  {dot(mode === "observe")} Observe
                </button>
                <button style={itemStyle} onClick={() => { takeControl(idx); setSeatMenu(null); }}>
                  {dot(mode === "control")} Control
                </button>
                <button style={itemStyle} onClick={() => { autopilotSeat(idx); setSeatMenu(null); }}>
                  {dot(mode === "autopilot")} Autopilot
                </button>
              </div>
            </>
          );
        })()}
    </div>
  );
}

const footBtn: CSSProperties = {
  background: "transparent",
  border: `1px solid ${C.border}`,
  color: C.muted,
  borderRadius: 6,
  padding: "4px 12px",
  fontFamily: F.mono,
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  cursor: "pointer",
};

import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import { computeAutoFeed } from "../shared/engine/apply";
import { legalActions, playerChoices } from "../shared/engine/legal";
import { Placement } from "../shared/engine/placements";
import { GameState } from "../shared/engine/types";
import { Controller, DEFAULT_BEDROCK_MODEL } from "../shared/protocol";
import { FeedDialog, PlacementDialog } from "./Dialogs";
import { GameSocket } from "./net";
import { ReplayApp } from "./Replay";
import { GameHeader } from "./agricogla/header";
import { GlobalView, FeedView, PlayerView } from "./agricogla/views";
import { Lobby, JoinPage } from "./agricogla/lobby";
import { Scrubber } from "./agricogla/scrubber";
import { ScoreBoard } from "./agricogla/scoreboard";
import { C, F } from "./agricogla/theme";
import {
  claimSeat,
  DiscordSession,
  isDiscordActivity,
  setupDiscord,
  startGame,
} from "./discord/sdk";

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
  if (isDiscordActivity()) return <DiscordActivity />;
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

/** Centered panel used by the Discord handshake / seat-choice screens. */
function ActivityShell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "0 20px",
        background:
          "radial-gradient(1200px 700px at 50% -10%, rgba(16,22,34,0.82) 0%, rgba(7,9,13,0.92) 55%), #07090d",
        color: C.ink,
        fontFamily: F.body,
        textAlign: "center",
      }}
    >
      <img src="art/logo-wordmark.png" alt="Agricogla" style={{ height: 44, mixBlendMode: "lighten" }} />
      {children}
    </div>
  );
}

function activityBtn(primary: boolean): CSSProperties {
  return {
    fontFamily: F.mono,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    padding: "12px 18px",
    borderRadius: 999,
    cursor: "pointer",
    background: primary ? C.ember : C.field,
    color: primary ? C.emberInk : C.ink,
    border: `1px solid ${primary ? C.ember : C.border}`,
  };
}

/** The Discord Activity entry: runs the handshake, lets the member take a seat
 *  or spectate, then renders the live game (GameApp) with that seat. */
function DiscordActivity() {
  const [session, setSession] = useState<DiscordSession | null>(null);
  const [seat, setSeat] = useState<{ playerIdx: number | null; token?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setupDiscord().then(setSession, (e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <ActivityShell>
        <p style={{ color: C.beg, maxWidth: 420 }}>⚠ Could not connect to Discord: {error}</p>
      </ActivityShell>
    );
  }
  if (!session) {
    return (
      <ActivityShell>
        <p style={{ color: C.muted }}>Connecting to Discord…</p>
      </ActivityShell>
    );
  }
  if (seat) {
    return (
      <GameApp
        initialSeat={seat}
        onStart={() => void startGame(session.accessToken)}
        allowRemove={false}
      />
    );
  }

  const take = async () => {
    setBusy(true);
    const grant = await claimSeat(session.accessToken).catch((e) => {
      setError(String(e));
      return null;
    });
    if (grant) {
      setSeat({ playerIdx: grant.playerIdx, token: grant.token });
    } else if (!error) {
      setNote("Table is full or the game already started — spectating.");
      setSeat({ playerIdx: null });
    }
  };

  const name = session.user.global_name || session.user.username;
  return (
    <ActivityShell>
      <p style={{ fontSize: 15 }}>
        Welcome, <strong>{name}</strong>.
      </p>
      {note && <p style={{ color: C.muted, maxWidth: 420 }}>{note}</p>}
      <div style={{ display: "flex", gap: 10 }}>
        <button disabled={busy} onClick={() => void take()} style={activityBtn(true)}>
          Take a seat ▶
        </button>
        <button disabled={busy} onClick={() => setSeat({ playerIdx: null })} style={activityBtn(false)}>
          Spectate
        </button>
      </div>
    </ActivityShell>
  );
}

/** Discord mode injects the seat (claimed via the Activity, not the URL), an
 *  onStart that fills empty seats with bots, and hides seat-removal (which would
 *  drift the Discord seat→token mapping). Standalone passes none of these. */
interface GameAppProps {
  initialSeat?: { playerIdx: number | null; token?: string };
  onStart?: () => void;
  allowRemove?: boolean;
}

function GameApp({ initialSeat, onStart, allowRemove = true }: GameAppProps = {}) {
  const [, setTick] = useState(0);
  const seat = initialSeat ?? routeSeat();
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
    return (
      <Lobby
        status={status}
        onAddBot={() => socket.addBot()}
        onStart={onStart ?? (() => socket.resume())}
        onRemove={allowRemove ? (i) => socket.removeSeat(i) : undefined}
      />
    );
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
      <GameHeader
        view={view}
        onSelect={setView}
        tabs={tabs}
        round={state.round}
        finished={finished}
        onTabContextMenu={
          !status.readOnly ? (seat, e) => setSeatMenu({ seat, x: e.clientX, y: e.clientY }) : undefined
        }
        rightSlot={
          <>
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
              data-testid="turn-chip"
              data-myturn={myTurn ? "true" : "false"}
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
          </>
        }
      />

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
          models={status.availableModels ?? []}
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
            <button data-testid="new-game" onClick={() => { setScoreClosed(false); socket.newGame(); }} title="new game — back to the lobby to set up a fresh table" style={footBtn}>
              ⌂ new game
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

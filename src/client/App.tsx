import { CSSProperties, useEffect, useRef, useState } from "react";
import { computeAutoFeed } from "../shared/engine/apply";
import { legalActions, playerChoices } from "../shared/engine/legal";
import { Placement } from "../shared/engine/placements";
import { GameState } from "../shared/engine/types";
import { FeedDialog, PlacementDialog } from "./Dialogs";
import { GameSocket } from "./net";
import { ReplayApp } from "./Replay";
import { GlobalView, FeedView, PlayerView } from "./agricogla/views";
import { Scrubber } from "./agricogla/scrubber";
import { ScoreBoard } from "./agricogla/scoreboard";
import { C, F, nextHarvest, STAGE_CHIPS, stageOf } from "./agricogla/theme";

function routeSeat(): { playerIdx: number | null; token?: string } {
  const match = /^\/player\/(\d+)/.exec(location.pathname);
  if (match) return { playerIdx: Number(match[1]) };
  if (location.pathname === "/client/player") {
    const params = new URLSearchParams(location.search);
    const slot = Number(params.get("slot"));
    if (Number.isInteger(slot) && slot >= 0) {
      return { playerIdx: slot, token: params.get("token") ?? undefined };
    }
  }
  return { playerIdx: null };
}

export function App() {
  if (location.pathname === "/client/replay") return <ReplayApp />;
  return <GameApp />;
}

interface Frame {
  round: number;
  seed: number;
  state: GameState;
}

const mono = F.mono;

function GameApp() {
  const [, setTick] = useState(0);
  const seat = routeSeat();
  const mySeat = seat.playerIdx;
  const socketRef = useRef<GameSocket | null>(null);
  if (!socketRef.current) {
    socketRef.current = new GameSocket(mySeat, () => setTick((t) => t + 1), seat.token);
  }
  const socket = socketRef.current;
  useEffect(() => {
    socket.connect();
  }, [socket]);

  const [view, setView] = useState<string>(mySeat !== null ? `p${mySeat}` : "global");
  const [dialogSpace, setDialogSpace] = useState<string | null>(null);
  const [histIndex, setHistIndex] = useState<number | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);

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

  if (!state || !status) {
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

  const autoOn = mySeat !== null && status.controllers[mySeat] === "llm";
  const thinking = status.thinking === mySeat && mySeat !== null;

  const submitPlacement = (placement: Placement) => {
    socket.place(placement);
    setDialogSpace(null);
  };
  const sendChat = (to: number | null, text: string) => socket.sendChat(to, text);

  // ---- header bits ----
  const tabs = [
    { id: "global", label: "GLOBAL", color: undefined as string | undefined },
    { id: "feed", label: "FEED", color: undefined as string | undefined },
    ...state.players.map((p) => ({
      id: `p${p.idx}`,
      label: p.idx === mySeat ? "YOUR FARM" : p.name.toUpperCase(),
      color: p.color as string | undefined,
    })),
  ];
  const stageNow = stageOf(state.round);
  const nh = nextHarvest(state.round);
  const curName = state.players[state.currentPlayer]?.name ?? "—";

  const turnChip = (() => {
    if (finished) return { text: "FINAL SCORES", bg: "transparent", color: C.inkDim, border: C.border, pulse: false };
    if (reviewing)
      return { text: `◀ REVIEWING R${displayRound} · back to live`, bg: "rgba(90,215,255,0.12)", color: C.cyan, border: "#3a6b80", pulse: false };
    if (myTurn) return { text: "● YOUR TURN — place a worker", bg: C.ember, color: C.emberInk, border: C.ember, pulse: true };
    if (state.phase === "feeding") return { text: "HARVEST — feeding", bg: "transparent", color: C.ember, border: "#6a5524", pulse: false };
    return { text: `placing: ${curName}`, bg: "transparent", color: C.inkDim, border: C.border, pulse: false };
  })();
  const onTurnChip = () => (reviewing ? setHistIndex(null) : setView(myTurn && mySeat !== null ? `p${mySeat}` : "global"));

  const appStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "12px 16px 8px",
    overflow: "hidden",
    background: "radial-gradient(1200px 700px at 50% -10%, #101622 0%, #07090d 55%)",
    color: C.ink,
    fontFamily: F.body,
    fontSize: 14,
  };

  return (
    <div style={appStyle}>
      {/* ===== header ===== */}
      <header style={{ flex: "none", display: "flex", alignItems: "center", gap: 16, padding: "2px 4px 10px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flex: "none" }}>
          <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: 27, letterSpacing: "0.05em", textTransform: "uppercase", color: C.ember, textShadow: "0 0 14px rgba(255,160,21,0.45)" }}>⌂</span>
          <span style={{ fontFamily: F.display, fontWeight: 800, fontSize: 27, letterSpacing: "0.05em", textTransform: "uppercase", background: "linear-gradient(90deg, #ffffff, #ffa015)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Agricogla</span>
          <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.14em", color: C.muted, textTransform: "uppercase" }}>cogame table</span>
        </div>

        <nav style={{ display: "flex", gap: 4, flex: "none" }}>
          {tabs.map((t) => {
            const active = view === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
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
                }}
              >
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
      {view === "feed" && <FeedView state={viewState} messages={visibleChat} mySeat={mySeat} onSend={sendChat} />}
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
          prompts={prompts.filter((p) => p.playerIdx === Number(view.slice(1)))}
          onToggleAuto={() => mySeat !== null && socket.setController(mySeat, autoOn ? "human" : "llm")}
          onGuidance={(text) => mySeat !== null && socket.setGuidance(mySeat, text)}
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
            <button onClick={() => socket.reset()} title="new game, next seed" style={footBtn}>
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
      {finished && <ScoreBoard state={state} onNewGame={() => socket.reset()} />}
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

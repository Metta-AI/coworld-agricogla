import { useState } from "react";
import { GameState } from "../shared/engine/types";
import { ActPromptWire } from "../shared/protocol";

export function EventLog({ state }: { state: GameState }) {
  const events = state.log.slice(-40).reverse();
  return (
    <div className="event-log">
      <h3>Chronicle</h3>
      <ul>
        {events.map((e, i) => (
          <li key={`${state.log.length - i}`} className={`ev-${e.type}`}>
            <span className="ev-round">r{e.round}</span> {e.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PromptsPanel({ prompts, state }: { prompts: ActPromptWire[]; state: GameState }) {
  const [open, setOpen] = useState<number | null>(null);
  if (prompts.length === 0) return null;
  const recent = prompts.slice(-20).reverse();
  return (
    <div className="prompts-panel">
      <h3>Autopilot transcripts</h3>
      <ul>
        {recent.map((p, i) => (
          <li key={i}>
            <button className="mini" onClick={() => setOpen(open === i ? null : i)}>
              r{p.round} {state.players[p.playerIdx]?.name ?? p.playerIdx} ({p.phase})
            </button>
            {open === i && <pre className="prompt-content">{p.content}</pre>}
          </li>
        ))}
      </ul>
    </div>
  );
}

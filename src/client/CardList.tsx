import { cardById } from "../shared/engine/cards";
import { Good, Goods } from "../shared/engine/types";
import { Token } from "./Token";

function CostLine({ cost }: { cost: Goods }) {
  const entries = Object.entries(cost).filter(([, n]) => (n ?? 0) > 0);
  if (entries.length === 0) return <span className="card-cost free">free</span>;
  return (
    <span className="card-cost">
      {entries.map(([g, n]) => (
        <span key={g} className="cost-part">
          <Token good={g as Good} size={15} />
          {n}
        </span>
      ))}
    </span>
  );
}

export interface CardViewProps {
  cardId: string;
  onClick?: () => void;
  disabled?: boolean;
  note?: string;
  small?: boolean;
}

export function CardView({ cardId, onClick, disabled, note, small }: CardViewProps) {
  const card = cardById(cardId);
  const kindClass =
    card.kind === "occupation" ? "occupation" : card.kind === "minor" ? "minor" : "major";
  return (
    <button
      className={`game-card ${kindClass}${small ? " small" : ""}${disabled ? " disabled" : ""}`}
      onClick={onClick}
      disabled={disabled || !onClick}
      title={card.text}
    >
      <span className="card-head">
        <span className="card-name">{card.name}</span>
        {card.vp ? <span className="card-vp">{card.vp}</span> : null}
      </span>
      <CostLine cost={card.cost ?? {}} />
      {!small && <span className="card-text">{card.text}</span>}
      {note && <span className="card-note">{note}</span>}
    </button>
  );
}

export function CardBacks({ count, kind }: { count: number; kind: "occupation" | "minor" }) {
  if (count <= 0) return null;
  return (
    <span className={`card-backs ${kind}`} title={`${count} ${kind} card(s) in hand`}>
      {Array.from({ length: Math.min(count, 7) }, (_, i) => (
        <span key={i} className="card-back" />
      ))}
      <span className="card-backs-count">{count}</span>
    </span>
  );
}

import { ReactNode, useMemo, useState } from "react";
import { applyPlacement, RuleError } from "../shared/engine/apply";
import { legalFieldSpaces, legalRoomSpaces, legalStableSpaces } from "../shared/engine/apply";
import { cardById } from "../shared/engine/cards";
import { validateFencePlan } from "../shared/engine/farmyard";
import { PlayerChoices } from "../shared/engine/legal";
import {
  BakeChoice,
  Conversion,
  ImprovementChoice,
  Placement,
  SowChoice,
} from "../shared/engine/placements";
import { GameState, Good, Goods } from "../shared/engine/types";
import { CardView } from "./CardList";
import { Farm } from "./Farm";
import { Token } from "./Token";

export function GoodsChips({ goods }: { goods: Goods }) {
  const entries = Object.entries(goods).filter(([, n]) => (n ?? 0) > 0);
  if (entries.length === 0) return null;
  return (
    <span className="goods-chips">
      {entries.map(([g, n]) => (
        <span key={g} className="chip" title={g}>
          <Token good={g as Good} size={18} />
          {n}
        </span>
      ))}
    </span>
  );
}

/** Bounded amount picker — a select of min..max integers (replaces number inputs). */
function AmountSelect({ value, max, min = 0, onChange }: { value: number; max: number; min?: number; onChange: (n: number) => void }) {
  const hi = Math.max(min, max, value);
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {Array.from({ length: hi - min + 1 }, (_, i) => min + i).map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}

export interface DialogProps {
  spaceId: string;
  state: GameState;
  playerIdx: number;
  choices: PlayerChoices;
  onSubmit: (placement: Placement) => void;
  onCancel: () => void;
}

function Modal({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function DryRunError({ error }: { error: string | null }) {
  return error ? <div className="dialog-error">{error}</div> : null;
}

/** Validate a placement against the engine without committing it. */
function useDryRun(state: GameState, playerIdx: number) {
  const [error, setError] = useState<string | null>(null);
  const trySubmit = (placement: Placement, submit: (p: Placement) => void) => {
    try {
      applyPlacement(state, playerIdx, placement);
      submit(placement);
    } catch (err) {
      setError(err instanceof RuleError ? err.message : String(err));
    }
  };
  return { error, trySubmit };
}

function FarmExpansionDialog(props: DialogProps) {
  const me = props.state.players[props.playerIdx]!;
  const [rooms, setRooms] = useState<number[]>([]);
  const [stables, setStables] = useState<number[]>([]);
  const [mode, setMode] = useState<"rooms" | "stables">("rooms");
  const { error, trySubmit } = useDryRun(props.state, props.playerIdx);

  // Simulate picks so adjacency updates as rooms are added.
  const simulated = useMemo(() => {
    const clone = structuredClone(me);
    for (const r of rooms) clone.spaces[r]!.kind = "room";
    for (const s of stables) clone.spaces[s]!.stable = true;
    return clone;
  }, [me, rooms, stables]);

  const selectable = new Set(
    mode === "rooms" ? legalRoomSpaces(simulated) : legalStableSpaces(simulated),
  );
  const selected = new Map<number, string>();
  for (const r of rooms) selected.set(r, "🏠");
  for (const s of stables) selected.set(s, "🐎");

  return (
    <Modal title="Farm Expansion">
      <div className="dialog-row">
        <button className={mode === "rooms" ? "tab active" : "tab"} onClick={() => setMode("rooms")}>
          Rooms <GoodsChips goods={props.choices.roomCost} />
        </button>
        <button
          className={mode === "stables" ? "tab active" : "tab"}
          onClick={() => setMode("stables")}
        >
          Stables <Token good="wood" size={15} />2 each ({props.choices.stablesLeft - stables.length}{" "}
          left)
        </button>
      </div>
      <Farm
        player={simulated}
        selectableCells={selectable}
        selectedCells={selected}
        onCellClick={(cell) => {
          if (mode === "rooms") {
            setRooms(rooms.includes(cell) ? rooms.filter((r) => r !== cell) : [...rooms, cell]);
          } else {
            setStables(
              stables.includes(cell) ? stables.filter((s) => s !== cell) : [...stables, cell],
            );
          }
        }}
      />
      <DryRunError error={error} />
      <div className="dialog-row">
        <button
          className="primary"
          disabled={rooms.length + stables.length === 0}
          onClick={() =>
            trySubmit({ action: "farm_expansion", rooms, stables }, props.onSubmit)
          }
        >
          Build
        </button>
        <button onClick={props.onCancel}>Cancel</button>
      </div>
    </Modal>
  );
}

function FarmlandDialog(props: DialogProps) {
  const me = props.state.players[props.playerIdx]!;
  const [spaces, setSpaces] = useState<number[]>([]);
  const [plowCard, setPlowCard] = useState<string | undefined>(undefined);
  const { error, trySubmit } = useDryRun(props.state, props.playerIdx);

  const plows = [...me.occupations, ...me.minors]
    .map(cardById)
    .filter((c) => c.plowExtra && (me.cardData[c.id]?.plowUses ?? 0) < c.plowExtra.uses);
  const maxFields = 1 + (plowCard ? (cardById(plowCard).plowExtra?.fields ?? 0) : 0);

  const simulated = useMemo(() => {
    const clone = structuredClone(me);
    for (const s of spaces) clone.spaces[s]!.kind = "field";
    return clone;
  }, [me, spaces]);
  const selectable = spaces.length < maxFields ? new Set(legalFieldSpaces(simulated)) : new Set<number>();
  const selected = new Map(spaces.map((s) => [s, "🟫"] as [number, string]));

  return (
    <Modal title={props.spaceId === "farmland" ? "Plow Fields" : "Plow"}>
      {plows.length > 0 && (
        <div className="dialog-row">
          <label>
            Plow improvement:{" "}
            <select value={plowCard ?? ""} onChange={(e) => setPlowCard(e.target.value || undefined)}>
              <option value="">none (1 field)</option>
              {plows.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (+{p.plowExtra!.fields})
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <Farm
        player={simulated}
        selectableCells={selectable}
        selectedCells={selected}
        onCellClick={(cell) =>
          setSpaces(spaces.includes(cell) ? spaces.filter((s) => s !== cell) : [...spaces, cell])
        }
      />
      <DryRunError error={error} />
      <div className="dialog-row">
        <button
          className="primary"
          disabled={spaces.length === 0}
          onClick={() => trySubmit({ action: "farmland", spaces, plowCard }, props.onSubmit)}
        >
          Plow {spaces.length} field(s)
        </button>
        <button onClick={props.onCancel}>Cancel</button>
      </div>
    </Modal>
  );
}

function LessonsDialog(props: DialogProps) {
  const cost = props.choices.occupationCostBySpace[props.spaceId] ?? 0;
  const { error, trySubmit } = useDryRun(props.state, props.playerIdx);
  return (
    <Modal title={`Play an Occupation (${cost} food)`}>
      <div className="card-grid">
        {props.choices.handOccupations.map((c) => (
          <CardView
            key={c.id}
            cardId={c.id}
            disabled={!c.prereqOk}
            note={c.prereqOk ? undefined : `needs ${c.prereqLabel}`}
            onClick={() =>
              trySubmit(
                { action: props.spaceId as "lessons", occupation: c.id },
                props.onSubmit,
              )
            }
          />
        ))}
      </div>
      <DryRunError error={error} />
      <div className="dialog-row">
        <button onClick={props.onCancel}>Cancel</button>
      </div>
    </Modal>
  );
}

interface ImprovementPickerProps extends DialogProps {
  allowMajor: boolean;
  optional: boolean;
  /** Wraps the chosen improvement into the right placement. */
  wrap: (improvement?: ImprovementChoice) => Placement;
  title: string;
}

function ImprovementPicker(props: ImprovementPickerProps) {
  const me = props.state.players[props.playerIdx]!;
  const { error, trySubmit } = useDryRun(props.state, props.playerIdx);
  const [bakeGrain, setBakeGrain] = useState(0);
  const [pendingOven, setPendingOven] = useState<string | null>(null);
  const fireplaces = me.majors.filter((m) => m === "fireplace2" || m === "fireplace3");

  const submitMajor = (cardId: string, returnFireplace?: string) => {
    const card = cardById(cardId);
    if (card.bake && (cardId === "clay_oven" || cardId === "stone_oven")) {
      setPendingOven(cardId);
      setBakeGrain(Math.min(me.resources.grain, card.bake.maxGrain));
      return;
    }
    trySubmit(props.wrap({ kind: "major", card: cardId, returnFireplace }), props.onSubmit);
  };

  if (pendingOven) {
    const card = cardById(pendingOven);
    const max = Math.min(me.resources.grain, card.bake!.maxGrain);
    const bake: BakeChoice[] = bakeGrain > 0 ? [{ card: pendingOven, grain: bakeGrain }] : [];
    return (
      <Modal title={`${card.name}: bake immediately?`}>
        <div className="dialog-row">
          <label>
            Grain to bake (worth {card.bake!.perGrain} food each):{" "}
            <AmountSelect value={bakeGrain} max={max} onChange={setBakeGrain} />
          </label>
        </div>
        <DryRunError error={error} />
        <div className="dialog-row">
          <button
            className="primary"
            onClick={() =>
              trySubmit(props.wrap({ kind: "major", card: pendingOven, bake }), props.onSubmit)
            }
          >
            Buy {card.name}
          </button>
          <button onClick={() => setPendingOven(null)}>Back</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={props.title}>
      {props.allowMajor && (
        <>
          <h4>Major improvements</h4>
          <div className="card-grid">
            {props.choices.majors.map((c) => {
              const canUpgrade =
                (c.id === "hearth4" || c.id === "hearth5") && fireplaces.length > 0;
              return (
                <div key={c.id} className="card-with-actions">
                  <CardView
                    cardId={c.id}
                    disabled={!c.affordable && !canUpgrade}
                    onClick={c.affordable ? () => submitMajor(c.id) : undefined}
                  />
                  {canUpgrade && (
                    <button className="mini" onClick={() => submitMajor(c.id, fireplaces[0])}>
                      upgrade fireplace
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      <h4>Minor improvements (your hand)</h4>
      <div className="card-grid">
        {props.choices.handMinors.map((c) => (
          <CardView
            key={c.id}
            cardId={c.id}
            disabled={!c.affordable || !c.prereqOk}
            note={!c.prereqOk ? `needs ${c.prereqLabel}` : !c.affordable ? "can't afford" : undefined}
            onClick={() => trySubmit(props.wrap({ kind: "minor", card: c.id }), props.onSubmit)}
          />
        ))}
      </div>
      <DryRunError error={error} />
      <div className="dialog-row">
        {props.optional && (
          <button className="primary" onClick={() => trySubmit(props.wrap(undefined), props.onSubmit)}>
            Skip improvement
          </button>
        )}
        <button onClick={props.onCancel}>Cancel</button>
      </div>
    </Modal>
  );
}

function FencesDialog(props: DialogProps & { withRenovate?: boolean }) {
  const me = props.state.players[props.playerIdx]!;
  const [edges, setEdges] = useState<Set<string>>(new Set());
  const { error, trySubmit } = useDryRun(props.state, props.playerIdx);
  const plan = [...edges];
  const result = plan.length > 0 ? validateFencePlan(me, plan) : null;
  const freeFences = [...me.occupations, ...me.minors]
    .map(cardById)
    .reduce((s, c) => s + (c.freeFences ?? 0), 0);
  const cost = Math.max(0, plan.length - freeFences);

  const wrap = (): Placement =>
    props.withRenovate
      ? { action: "r_redevelop", edges: plan }
      : { action: "r_fences", edges: plan };

  return (
    <Modal title={props.withRenovate ? "Renovate, then Fences" : "Build Fences"}>
      <p className="dialog-hint">
        Click edges to plan fences. Every fence must enclose a pasture. Cost:{" "}
        <Token good="wood" size={15} />
        {cost}
        {freeFences > 0 ? ` (${freeFences} free)` : ""} — wood: {me.resources.wood}
        {props.withRenovate ? " (after renovating)" : ""}
      </p>
      <div className="dialog-row">
        {props.choices.fencePlans.slice(0, 5).map((p, i) => (
          <button key={i} className="mini" onClick={() => setEdges(new Set(p.edges))}>
            {p.cells.length}-cell ({p.cost} wood)
          </button>
        ))}
        <button className="mini" onClick={() => setEdges(new Set())}>
          clear
        </button>
      </div>
      <Farm
        player={me}
        fenceMode
        plannedEdges={edges}
        onEdgeClick={(edge) => {
          const next = new Set(edges);
          if (next.has(edge)) next.delete(edge);
          else next.add(edge);
          setEdges(next);
        }}
      />
      {result && !result.ok && <div className="dialog-error">{result.error}</div>}
      <DryRunError error={error} />
      <div className="dialog-row">
        {props.withRenovate && (
          <button
            className="primary"
            onClick={() => trySubmit({ action: "r_redevelop", edges: [] }, props.onSubmit)}
          >
            Renovate only
          </button>
        )}
        <button
          className="primary"
          disabled={plan.length === 0 || (result !== null && !result.ok)}
          onClick={() => trySubmit(wrap(), props.onSubmit)}
        >
          {props.withRenovate ? "Renovate + fence" : `Build ${plan.length} fences`}
        </button>
        <button onClick={props.onCancel}>Cancel</button>
      </div>
    </Modal>
  );
}

function SowBakeDialog(props: DialogProps & { withPlow?: boolean }) {
  const me = props.state.players[props.playerIdx]!;
  const [sow, setSow] = useState<Map<number, "grain" | "vegetable">>(new Map());
  const [bake, setBake] = useState<Map<string, number>>(new Map());
  const [plow, setPlow] = useState<number | undefined>(undefined);
  const { error, trySubmit } = useDryRun(props.state, props.playerIdx);

  const grainUsed = [...sow.values()].filter((c) => c === "grain").length;
  const vegUsed = [...sow.values()].filter((c) => c === "vegetable").length;
  const grainBaked = [...bake.values()].reduce((s, n) => s + n, 0);

  const simulated = useMemo(() => {
    const clone = structuredClone(me);
    if (plow !== undefined) clone.spaces[plow]!.kind = "field";
    return clone;
  }, [me, plow]);

  const sowable = new Set(
    simulated.spaces
      .map((_, i) => i)
      .filter((i) => simulated.spaces[i]!.kind === "field" && simulated.spaces[i]!.cropCount === 0),
  );
  const plowable = props.withPlow && plow === undefined ? new Set(legalFieldSpaces(me)) : new Set<number>();
  const selectable = new Set([...sowable, ...plowable]);
  const selected = new Map<number, string>();
  if (plow !== undefined) selected.set(plow, "🟫");
  for (const [cell, crop] of sow) selected.set(cell, crop === "grain" ? "🌾" : "🥕");

  const cycle = (cell: number) => {
    if (plowable.has(cell)) {
      setPlow(cell);
      return;
    }
    if (!sowable.has(cell)) return;
    const next = new Map(sow);
    const cur = next.get(cell);
    if (cur === undefined && me.resources.grain - grainUsed - grainBaked > 0) {
      next.set(cell, "grain");
    } else if ((cur === undefined || cur === "grain") && me.resources.vegetable - vegUsed > 0) {
      next.set(cell, "vegetable");
    } else {
      next.delete(cell);
    }
    setSow(next);
  };

  const sowChoices: SowChoice[] = [...sow.entries()].map(([space, crop]) => ({ space, crop }));
  const bakeChoices: BakeChoice[] = [...bake.entries()]
    .filter(([, n]) => n > 0)
    .map(([card, grain]) => ({ card, grain }));

  const placement: Placement = props.withPlow
    ? { action: "r_cultivation", plow, sow: sowChoices }
    : { action: "r_sow_bake", sow: sowChoices, bake: bakeChoices };

  return (
    <Modal title={props.withPlow ? "Plow and/or Sow" : "Sow and/or Bake Bread"}>
      <p className="dialog-hint">
        Click fields to cycle: grain → vegetable → empty. Grain {me.resources.grain - grainUsed - grainBaked},
        vegetables {me.resources.vegetable - vegUsed}.
        {props.withPlow ? " Click an empty space to plow it first." : ""}
      </p>
      <Farm player={simulated} selectableCells={selectable} selectedCells={selected} onCellClick={cycle} />
      {!props.withPlow && props.choices.bakeOptions.length > 0 && (
        <div className="dialog-col">
          <h4>Bake bread</h4>
          {props.choices.bakeOptions.map((b) => (
            <label key={b.card}>
              {b.name} ({b.perGrain} food/grain, max {b.maxGrain}):{" "}
              <AmountSelect
                value={bake.get(b.card) ?? 0}
                max={Math.min(b.maxGrain, me.resources.grain - grainUsed)}
                onChange={(n) => {
                  const next = new Map(bake);
                  next.set(b.card, n);
                  setBake(next);
                }}
              />
            </label>
          ))}
        </div>
      )}
      <DryRunError error={error} />
      <div className="dialog-row">
        <button
          className="primary"
          disabled={sowChoices.length === 0 && bakeChoices.length === 0 && plow === undefined}
          onClick={() => trySubmit(placement, props.onSubmit)}
        >
          Confirm
        </button>
        <button onClick={props.onCancel}>Cancel</button>
      </div>
    </Modal>
  );
}

/** Routes a clicked action space to the right parameter dialog (or none). */
export function PlacementDialog(props: DialogProps) {
  const simple: Placement | null = (() => {
    switch (props.spaceId) {
      case "grain_seeds":
      case "day_laborer":
      case "forest":
      case "clay_pit":
      case "reed_bank":
      case "fishing":
      case "copse":
      case "grove":
      case "hollow":
      case "quarry_stall":
      case "resource_market":
      case "traveling_players":
      case "r_sheep":
      case "r_west_quarry":
      case "r_vegetable":
      case "r_boar":
      case "r_east_quarry":
      case "r_cattle":
      case "r_urgent_family":
        return { action: props.spaceId } as Placement;
      default:
        return null;
    }
  })();
  if (simple) {
    // No parameters: confirm immediately.
    props.onSubmit(simple);
    return null;
  }
  switch (props.spaceId) {
    case "farm_expansion":
      return <FarmExpansionDialog {...props} />;
    case "farmland":
      return <FarmlandDialog {...props} />;
    case "lessons":
    case "lessons_b":
      return <LessonsDialog {...props} />;
    case "meeting_place":
      return (
        <ImprovementPicker
          {...props}
          allowMajor={false}
          optional
          title="Meeting Place: starting player + optional minor improvement"
          wrap={(improvement) => ({ action: "meeting_place", improvement })}
        />
      );
    case "r_improvement":
      return (
        <ImprovementPicker
          {...props}
          allowMajor
          optional={false}
          title="Buy a Major or play a Minor Improvement"
          wrap={(improvement) => ({ action: "r_improvement", improvement: improvement! })}
        />
      );
    case "r_renovate_improve":
      return (
        <ImprovementPicker
          {...props}
          allowMajor
          optional
          title="Renovate, then optionally an Improvement"
          wrap={(improvement) => ({ action: "r_renovate_improve", improvement })}
        />
      );
    case "r_family_growth":
      return (
        <ImprovementPicker
          {...props}
          allowMajor={false}
          optional
          title="Family Growth, then optionally a Minor Improvement"
          wrap={(improvement) => ({ action: "r_family_growth", improvement })}
        />
      );
    case "r_fences":
      return <FencesDialog {...props} />;
    case "r_redevelop":
      return <FencesDialog {...props} withRenovate />;
    case "r_sow_bake":
      return <SowBakeDialog {...props} />;
    case "r_cultivation":
      return <SowBakeDialog {...props} withPlow />;
    default:
      return null;
  }
}

export interface FeedDialogProps {
  state: GameState;
  playerIdx: number;
  choices: PlayerChoices;
  onSubmit: (conversions: Conversion[]) => void;
  onAuto: () => void;
}

export function FeedDialog({ state, playerIdx, choices, onSubmit, onAuto }: FeedDialogProps) {
  const me = state.players[playerIdx]!;
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const key = (via: string, good: string) => `${via}|${good}`;

  let extraFood = 0;
  for (const opt of choices.conversionOptions) {
    extraFood += (counts.get(key(opt.via, opt.good)) ?? 0) * opt.foodEach;
  }
  const total = me.resources.food + extraFood;
  const missing = Math.max(0, choices.foodNeededNow - total);

  return (
    <Modal title={`Harvest: feed your family (${choices.foodNeededNow} food)`}>
      <p className="dialog-hint">
        You have {me.resources.food} food{extraFood > 0 ? ` + ${extraFood} from conversions` : ""}.{" "}
        {missing > 0 ? `Short ${missing} → ${missing} begging card(s) (-3 each).` : "Enough — no begging."}
      </p>
      <div className="dialog-col">
        {choices.conversionOptions.map((opt) => {
          const k = key(opt.via, opt.good);
          return (
            <label key={k}>
              <Token good={opt.good as Good} size={18} /> {opt.good} → {opt.foodEach} food (
              {opt.name}, max {opt.max}):{" "}
              <AmountSelect
                value={counts.get(k) ?? 0}
                max={opt.max}
                onChange={(n) => {
                  const next = new Map(counts);
                  next.set(k, n);
                  setCounts(next);
                }}
              />
            </label>
          );
        })}
        {choices.conversionOptions.length === 0 && <p>No conversions available.</p>}
      </div>
      <div className="dialog-row">
        <button
          className="primary"
          onClick={() =>
            onSubmit(
              [...counts.entries()]
                .filter(([, n]) => n > 0)
                .map(([k, count]) => {
                  const [via, good] = k.split("|");
                  return { via: via!, good: good! as Conversion["good"], count };
                }),
            )
          }
        >
          Feed{missing > 0 ? ` (beg ${missing})` : ""}
        </button>
        <button onClick={onAuto}>Auto-feed</button>
      </div>
    </Modal>
  );
}

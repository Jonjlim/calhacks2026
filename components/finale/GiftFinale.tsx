"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type FormEvent, useEffect, useState } from "react";
import type { RoomActions, RoomData } from "@/components/room/types";
import type { AppError } from "@/lib/contracts";
import { formatMinor, parseMajorToMinor } from "@/lib/money";
import { avatarFor, portraitUrl } from "@/lib/room/avatars";
import { equalSplit, summarizeShares } from "@/lib/room/shares";
import { useResultAction } from "@/lib/useResultAction";
import s from "./finale.module.css";

/**
 * The last stretch of the game, in three quiet steps over the world, and then the
 * end:
 *
 *   1. Plan our contributions: everyone sees their share of this exact proposal,
 *      may set a private limit, and says yes (the existing approval).
 *   2. Checkout: once everyone has said yes, each friend completes a clearly
 *      simulated checkout for their share. No card, no charge, no order.
 *   3. Wrap: when every share is in, the organizer wraps the gift.
 *
 * Wrapping is shared state, so every friend, on any device, arrives at the same
 * End screen, which is final: there is no way back to the map from it.
 */

import { finaleStepOf as stepOf, type Step } from "./steps";

/** The gift this proposal is for, from the frozen revision (a whole box may hold several). */
function giftTitle(data: RoomData): string {
  const items = data.proposal.revision?.items ?? data.selection?.items;
  if (items && items.length > 1) return `${items[0]!.listingSnapshot.title} and ${items.length - 1} more`;
  return items?.[0]?.listingSnapshot.title ?? data.selection?.listingSnapshot.title ?? "Our gift";
}

export function useFinaleStep(data: RoomData): Step {
  return stepOf(data.simulation?.view.status);
}

export function GiftFinale({ data, actions, isOrganizer, open, onClose, hideClose }: { data: RoomData; actions?: RoomActions; isOrganizer: boolean; open: boolean; onClose(): void; hideClose?: boolean }) {
  const step = useFinaleStep(data);
  const reduced = useReducedMotion() ?? false;
  // The end takes over everything, for everyone, and cannot be dismissed.
  if (step === "end") return <TheEnd data={data} reduced={reduced} />;
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="finale"
          role="dialog"
          aria-modal="false"
          aria-label="Plan our contributions"
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 30, transition: { duration: 0.25 } }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className={s.panel}
        >
          <Steps step={step} />
          {step === "plan" && <Plan data={data} actions={actions} />}
          {step === "checkout" && <Checkout data={data} />}
          {step === "wrap" && <Wrap data={data} isOrganizer={isOrganizer} />}
          {!hideClose && <button type="button" className={s.close} onClick={onClose}>Back to the map for now</button>}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Steps({ step }: { step: Step }) {
  const items: [Step, string][] = [["plan", "Plan"], ["checkout", "Checkout"], ["wrap", "Wrap"]];
  const at = items.findIndex(([k]) => k === step);
  return (
    <ol className={s.steps} aria-label="Where we are">
      {items.map(([k, label], i) => (
        <li key={k} className={i < at ? s.done : i === at ? s.now : ""} aria-current={i === at ? "step" : undefined}>
          <span>{i < at ? "✓" : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

function Head({ data, kicker, title }: { data: RoomData; kicker: string; title: string }) {
  const price = data.proposal.revision?.payableTotalMinor;
  return (
    <header className={s.head}>
      <p className={s.kicker}>{kicker}</p>
      <h2>{title}</h2>
      <p className={s.gift}>
        {giftTitle(data)}
        {price !== undefined && <strong> · {formatMinor(price, data.proposal.revision?.currency)}</strong>}
      </p>
    </header>
  );
}

/**
 * Who pays what, with the arithmetic shown: every friend's share, how it compares
 * with an equal split, and a check that the shares add back to the total to the
 * cent. The shares come from the room's own allocation; this only displays them.
 */
function ShareTable({ data, yes }: { data: RoomData; yes?: Set<string> }) {
  const { participants, me } = data.view;
  const revision = data.proposal.revision!;
  const currency = revision.currency;
  const total = revision.payableTotalMinor;
  const payers = revision.shares;
  const sum = summarizeShares(total, payers);
  const equal = equalSplit(total, payers.map((x) => x.participantId));
  const name = (id: string) => (id === me.id ? "You" : participants.find((p) => p.id === id)?.displayName ?? "A friend");
  const per = payers.length ? Math.floor(total / payers.length) : 0;
  return (
    <div className={s.table}>
      <p className={s.mode}>
        <b>{sum.isEqual ? "Split equally" : "Split by limits"}</b>
        {sum.isEqual
          ? ` · ${formatMinor(total, currency)} between ${payers.length} is ${formatMinor(per, currency)} each${equal.some((x) => x.amountMinor !== per) ? ", with the odd cents going to the first friends" : ""}.`
          : ` · an equal split would be ${formatMinor(per, currency)} each, but someone's limit is lower, so the others cover the difference.`}
      </p>
      <ul className={s.people} aria-label="Everyone's share">
        {payers.map((share) => {
          const d = sum.deltas[share.participantId] ?? 0;
          return (
            <li key={share.participantId} className={yes?.has(share.participantId) ? s.yes : ""}>
              <img src={portraitUrl(avatarFor(participants, share.participantId))} alt="" />
              <b>{name(share.participantId)}</b>
              <span>{formatMinor(share.amountMinor, currency)}</span>
              <small>{yes ? (yes.has(share.participantId) ? "Said yes" : "Not yet") : !sum.isEqual && Math.abs(d) > 1 ? `${d > 0 ? "+" : "−"}${formatMinor(Math.abs(d), currency)}` : "equal"}</small>
            </li>
          );
        })}
      </ul>
      <p className={`${s.sumline} ${sum.adds ? "" : s.bad}`} role="status">
        <span>{payers.map((x) => formatMinor(x.amountMinor, currency)).join(" + ")}</span>
        <b>= {formatMinor(sum.sumMinor, currency)}</b>
        <i aria-hidden>{sum.adds ? "✓" : "!"}</i>
      </p>
      <p className={s.sumnote}>{sum.adds ? `Adds up to the ${formatMinor(total, currency)} the gift costs.` : `These add up to ${formatMinor(sum.sumMinor, currency)}, not ${formatMinor(total, currency)}. The shares are being recalculated.`}</p>
    </div>
  );
}

function Plan({ data, actions }: { data: RoomData; actions?: RoomActions }) {
  const { participants, me } = data.view;
  const revision = data.proposal.revision;
  const approvals = data.proposal.approvals.filter((a) => a.revisionId === revision?.id);
  const yes = new Set(approvals.filter((a) => a.status === "approved").map((a) => a.participantId));
  const mine = revision?.shares.find((x) => x.participantId === me.id);
  const [limit, setLimit] = useState(data.proposal.myLimit ? (data.proposal.myLimit.amountMinor / 100).toFixed(2) : "");
  const [limitError, setLimitError] = useState<AppError | null>(null);
  const save = useResultAction(actions?.setLimit);
  const approve = useResultAction(actions?.approve);
  const withdraw = useResultAction(actions?.withdrawApproval);
  const name = (id: string) => (id === me.id ? "You" : participants.find((p) => p.id === id)?.displayName ?? "A friend");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const minor = parseMajorToMinor(limit);
    if (minor === null) return setLimitError({ code: "validation_failed", message: "Enter an amount like 40 or 40.50." });
    setLimitError(null);
    await save.run(minor);
  };
  const error = limitError ?? save.error ?? approve.error ?? withdraw.error;

  if (!revision) {
    return (
      <>
        <Head data={data} kicker="Almost there" title="Plan our contributions" />
        <p className={s.soft}>The shares appear as soon as the organizer has put a gift in the box.</p>
      </>
    );
  }
  const infeasible = revision.status === "infeasible";
  const agreed = revision.shares.filter((x) => yes.has(x.participantId)).length;
  return (
    <>
      <Head data={data} kicker="Step 1 · Plan" title="Plan our contributions" />
      {infeasible ? (
        <p role="alert" className={s.warn}>{revision.conditions[0] ?? "The limits don’t cover this gift yet."} Raise a limit, or choose a gentler gift. A limit left empty counts as $0.</p>
      ) : (
        <>
          <ShareTable data={data} yes={yes} />
          <p className={s.progress} role="status">{agreed} of {revision.shares.length} have said yes. {agreed === revision.shares.length ? "Everyone is in." : "Checkout opens when everyone is."}</p>
        </>
      )}

      {actions && (
        <form onSubmit={submit} className={s.limit}>
          <div className={s.equalBox}>
            <p><b>Split equally</b>{revision ? ` · ${formatMinor(Math.floor(revision.payableTotalMinor / Math.max(1, revision.shares.length)), revision.currency)} each` : ""}</p>
            <small>Everyone covers the same amount. It works once every friend picks it.</small>
            <button type="button" className={s.ghost} disabled={save.pending || !revision} onClick={() => revision && save.run(revision.payableTotalMinor)}>Use an equal split</button>
          </div>
          <label htmlFor="finale-limit">Or set your own limit <small>only you can see it</small></label>
          <div>
            <input id="finale-limit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="$40" />
            <button type="submit" disabled={save.pending || !limit.trim()}>{save.pending ? "Saving…" : data.proposal.myLimit ? "Update" : "Set"}</button>
          </div>
        </form>
      )}

      {actions && !infeasible && mine !== undefined && (
        yes.has(me.id) ? (
          <div className={s.row}>
            <p className={s.mine}>You’re in for {formatMinor(mine.amountMinor, revision.currency)}</p>
            <button type="button" className={s.ghost} disabled={withdraw.pending} onClick={() => withdraw.run(revision.id)}>Take back my yes</button>
          </div>
        ) : (
          <button type="button" className={s.primary} disabled={approve.pending} onClick={() => approve.run(revision.id)}>
            {approve.pending ? "Saving…" : `Yes, I’m in for ${formatMinor(mine.amountMinor, revision.currency)}`}
          </button>
        )
      )}
      {error && <p role="alert" className={s.warn}>{error.message}</p>}
      <p className={s.fine}>Saying yes is a pledge. Nothing is charged until checkout, and checkout here is a simulation.</p>
    </>
  );
}

/** A mock checkout: an order summary, a stand-in payment method and one button. No card is ever asked for. */
function Checkout({ data }: { data: RoomData }) {
  const sim = data.simulation!;
  const view = sim.view;
  const revision = data.proposal.revision;
  const currency = revision?.currency ?? "USD";
  const [stage, setStage] = useState<"idle" | "processing" | "paid">("idle");
  const run = useResultAction(sim.simulate);
  // The order is exactly what the proposal froze: each gift in the box at the price and shipping that were observed for it.
  const legacy = data.selection && !revision?.items?.length && !data.selection.items?.length ? [{ listingId: data.selection.listingId, quantity: 1 as const, listingSnapshot: { ...data.selection.listingSnapshot, currency, shippingStatus: "unknown" as const, imageUrl: undefined as string | undefined } }] : [];
  const items = revision?.items?.length ? revision.items : data.selection?.items?.length ? data.selection.items : legacy;
  const lines = items.map((i) => {
    const snap = i.listingSnapshot;
    const live = data.listings.find((l) => l.id === i.listingId);
    const price = snap.priceStatus === "observed" ? snap.priceMinor : undefined;
    const ship = snap.shippingStatus === "observed" ? snap.shippingMinor : undefined;
    return { id: i.listingId, title: snap.title, image: snap.imageUrl ?? live?.imageUrl, seller: live?.sellerName, url: snap.sourceUrl, price, ship, sample: live?.source === "manual_fixture" };
  });
  const itemsTotal = lines.reduce((n, l) => n + (l.price ?? 0) + (l.ship ?? 0), 0);
  const total = revision?.payableTotalMinor ?? itemsTotal;
  const people = revision?.shares.filter((x) => x.amountMinor > 0).length ?? view.payerCount;
  useEffect(() => {
    if (view.myCompleted) setStage("paid");
  }, [view.myCompleted]);

  const pay = async () => {
    setStage("processing");
    // A short, honest pause so the step feels like a step; the call itself is instant.
    await new Promise((r) => setTimeout(r, 1100));
    const res = await run.run();
    setStage(res.ok ? "paid" : "idle");
  };

  return (
    <>
      <Head data={data} kicker="Step 2 · Checkout" title="Your share" />
      <section className={s.receipt} aria-label="Order summary">
        <h3>Order summary</h3>
        {lines.map((l) => (
          <div key={l.id} className={s.item}>
            {l.image ? <img src={l.image} alt="" /> : <span aria-hidden className={s.noImg} />}
            <div>
              <b>{l.title}</b>
              <small>{l.seller ? `${l.seller} · ` : ""}{l.sample ? "Sample listing · " : ""}{l.url ? <a href={l.url} target="_blank" rel="noopener noreferrer">source</a> : "no source saved"}</small>
              <p className={s.line}><span>Item</span><b>{l.price !== undefined ? formatMinor(l.price, currency) : "Price unknown"}</b></p>
              <p className={`${s.line} ${l.ship === undefined ? s.mutedLine : ""}`}><span>Shipping</span><b>{l.ship !== undefined ? formatMinor(l.ship, currency) : "Not known, not included"}</b></p>
            </div>
          </div>
        ))}
        <p className={`${s.line} ${s.mutedLine}`}><span>Tax</span><b>Not known, not included</b></p>
        <p className={`${s.line} ${s.sub}`}><span>Total to cover</span><b>{formatMinor(total, currency)}</b></p>
        <p className={`${s.line} ${s.total}`}><span>Your share{people > 1 ? ` (of ${people})` : ""}</span><b>{formatMinor(view.myShareMinor, currency)}</b></p>
      </section>

      {revision && revision.status !== "infeasible" && <ShareTable data={data} />}

      <div className={s.method} aria-label="Payment method">
        <span aria-hidden className={s.card}><i>VISA</i></span>
        <div><b>Visa ending 4242</b><small>A sample card. No real card is used or charged.</small></div>
        <i aria-hidden>✓</i>
      </div>

      {view.myShareMinor === 0 ? (
        <p className={s.soft}>You have no share to pay. You’re part of it all the same.</p>
      ) : stage === "paid" || view.myCompleted ? (
        <p className={s.paid} role="status"><span aria-hidden>✓</span> Your share is in. Thank you.</p>
      ) : (
        <button type="button" data-sfx="coin" className={s.primary} disabled={stage === "processing" || !view.canSimulate} onClick={pay}>
          {stage === "processing" ? <><span className={s.spin} aria-hidden /> Processing…</> : `Complete checkout · ${formatMinor(view.myShareMinor, currency)}`}
        </button>
      )}
      {run.error && <p role="alert" className={s.warn}>{run.error.message}</p>}

      <p className={s.progress} role="status">{view.completedCount} of {view.payerCount} shares are in.</p>
      <div className={s.meter} aria-hidden><i style={{ width: `${view.payerCount ? (view.completedCount / view.payerCount) * 100 : 0}%` }} /></div>
    </>
  );
}

function Wrap({ data, isOrganizer }: { data: RoomData; isOrganizer: boolean }) {
  const sim = data.simulation!;
  const wrap = useResultAction(sim.wrap);
  const organizer = data.view.participants.find((p) => p.role === "organizer");
  return (
    <>
      <Head data={data} kicker="Step 3 · Wrap" title="Every share is in" />
      <p className={s.soft}>
        {isOrganizer ? "Everyone has said yes and paid their share. Wrap the gift to finish." : `Everyone is in. ${organizer?.displayName ?? "The organizer"} wraps the gift next, and you will see it here the moment they do.`}
      </p>
      {isOrganizer && sim.view.canWrap && (
        <button type="button" data-sfx="coin" className={s.primary} disabled={wrap.pending} onClick={() => wrap.run()}>
          {wrap.pending ? "Wrapping…" : "Wrap the gift"}
        </button>
      )}
      {wrap.error && <p role="alert" className={s.warn}>{wrap.error.message}</p>}
      <p className={s.fine}>This ends the game for everyone. It is a simulation: no money moves.</p>
    </>
  );
}

/** A gift box with its lid thrown open and its ribbon undone: the front panel of the box, in the world's cream and coral. */
function OpenBox({ reduced }: { reduced: boolean }) {
  return (
    <svg className={s.box} viewBox="0 0 260 170" aria-hidden>
      <ellipse cx="130" cy="158" rx="104" ry="9" fill="#41344f" opacity="0.12" />
      {/* the back wall and the inside */}
      <path d="M36 62 L224 62 L214 40 L46 40 Z" fill="#e9b9a6" />
      <path d="M36 62 L224 62 L224 70 L36 70 Z" fill="#d79a86" />
      {/* the lid, tipped open behind */}
      <g className={reduced ? "" : s.lid}>
        <path d="M30 40 L230 40 L214 6 L46 6 Z" fill="#f6e6c6" stroke="#d6bf93" strokeWidth="2" strokeLinejoin="round" />
        <path d="M118 40 L142 40 L136 6 L124 6 Z" fill="#d9826a" />
        <path d="M30 40 L230 40 L228 48 L32 48 Z" fill="#e6d1a8" />
      </g>
      {/* the front of the box */}
      <path d="M32 62 L228 62 L220 152 Q220 158 214 158 L46 158 Q40 158 40 152 Z" fill="#fbf0d8" stroke="#dcc79c" strokeWidth="2" strokeLinejoin="round" />
      <path d="M118 62 L142 62 L142 158 L118 158 Z" fill="#d9826a" />
      <path d="M32 62 L228 62 L226 76 L34 76 Z" fill="#f2e1bd" />
      {/* a few painted stars on the paper */}
      {[[68, 106], [96, 134], [176, 112], [198, 138], [74, 142]].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y! - 6} l2.2 4.6 5 .7 -3.6 3.5 .9 5 -4.5 -2.4 -4.5 2.4 .9 -5 -3.6 -3.5 5 -.7z`} fill="#e9a98f" opacity="0.8" />
      ))}
      {/* the ribbon, untied, hanging over the front edge */}
      <path d="M130 62 C100 70 88 90 96 110 C102 124 90 136 80 140" fill="none" stroke="#d9826a" strokeWidth="9" strokeLinecap="round" opacity="0.9" />
      <path d="M130 62 C160 70 176 86 170 104" fill="none" stroke="#e48572" strokeWidth="9" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

/** The last screen. Everyone arrives here together, it has no way back to the map, and it says plainly that it is over. */
export function TheEnd({ data, reduced }: { data: RoomData; reduced: boolean }) {
  const { participants, room } = data.view;
  const revision = data.proposal.revision;
  const currency = revision?.currency ?? "USD";
  const payers = (revision?.shares ?? []).filter((x) => x.amountMinor > 0);
  const total = payers.reduce((n, x) => n + x.amountMinor, 0);
  const name = (id: string) => participants.find((p) => p.id === id)?.displayName ?? "A friend";
  const photo = data.selection?.items?.[0]?.listingSnapshot.imageUrl ?? data.listings.find((l) => l.id === data.selection?.listingId)?.imageUrl;
  const [failed, setFailed] = useState(false);
  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="The end"
      className={s.end}
      initial={reduced ? { opacity: 0 } : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0.2 : 1.1 }}
    >
      <div className={s.endConfetti} aria-hidden>
        {Array.from({ length: 26 }, (_, i) => <i key={i} style={{ ["--i" as string]: i }} />)}
      </div>
      <motion.div
        className={s.endCard}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 30, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: reduced ? 0 : 0.5, duration: reduced ? 0.2 : 0.9, ease: [0.22, 1, 0.36, 1] }}
      >
        <p className={s.endKicker}>A little of all of you</p>
        <h1>The gift is wrapped.</h1>
        <div className={s.endGift}>
          <div className={s.stage} aria-hidden={!photo}>
            <span className={s.glow} aria-hidden />
            {/* The product rises out of the open box and settles on top of it. */}
            <motion.div
              className={s.product}
              initial={reduced ? { opacity: 0 } : { y: 90, scale: 0.55, opacity: 0, rotate: -8 }}
              animate={{ y: 0, scale: 1, opacity: 1, rotate: -2 }}
              transition={{ delay: reduced ? 0 : 1.5, duration: reduced ? 0.2 : 1.3, type: reduced ? "tween" : "spring", stiffness: 70, damping: 11 }}
            >
              {photo && !failed ? <img src={photo} alt={giftTitle(data)} onError={() => setFailed(true)} /> : <span className={s.noPhoto}>{giftTitle(data)}</span>}
            </motion.div>
            <OpenBox reduced={reduced} />
          </div>
          <p>{giftTitle(data)}</p>
        </div>
        <p className={s.endLine}>
          {room.recipientDisplayName ? `For ${room.recipientDisplayName}, ` : ""}from {payers.length ? payers.map((x) => name(x.participantId)).join(", ").replace(/, ([^,]*)$/, " and $1") : "everyone who remembered"}.
        </p>
        {payers.length > 0 && (
          <ul className={s.endPeople} aria-label="Who gave">
            {payers.map((x) => (
              <li key={x.participantId}>
                <img src={portraitUrl(avatarFor(participants, x.participantId))} alt="" />
                <b>{name(x.participantId)}</b>
                <span>{formatMinor(x.amountMinor, currency)}</span>
              </li>
            ))}
            <li className={s.endTotal}><b>Together</b><span>{formatMinor(total, currency)}</span></li>
          </ul>
        )}
        <a href="/" className={s.home}>Back to home</a>
      </motion.div>
    </motion.div>
  );
}

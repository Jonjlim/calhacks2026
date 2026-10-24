"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Panel } from "@/components/ui/Panel";
import { errorText, unwrap } from "@/lib/live/result";

const CATEGORIES = ["interest", "dislike", "ownership", "size", "constraint"] as const;
const QUESTION_TYPES = ["suitability", "ownership", "constraint"] as const;
type Category = (typeof CATEGORIES)[number];
type QuestionType = (typeof QUESTION_TYPES)[number];
type Pref = { category: Category; text: string; disclosable: boolean; authorized: boolean };

/** Organizer-only synthetic profile editor. Shown only when the deployment enables the demo. */
export function RecipientDemo({ roomId, isOrganizer }: { roomId: Id<"rooms">; isOrganizer: boolean }) {
  const activity = unwrap(useQuery(api.agents.buyer.listActivity, { roomId }));
  const enabled = activity.value?.capabilities.recipientDemoEnabled === true;
  if (activity.loading) return null;
  if (!enabled)
    return (
      <Panel title="Recipient agent (demo)">
        <p className="text-sm text-plum-soft">The synthetic recipient-agent demo is off on this deployment.</p>
      </Panel>
    );
  if (!isOrganizer)
    return (
      <Panel title="Recipient agent (demo)">
        <p className="text-sm text-plum-soft">Only the organizer can set up the synthetic recipient profile.</p>
      </Panel>
    );
  return <Editor roomId={roomId} />;
}

function Editor({ roomId }: { roomId: Id<"rooms"> }) {
  const profile = unwrap(useQuery(api.agents.recipient.getMyProfile, { roomId }));
  const createProfile = useMutation(api.agents.recipient.createProfile);
  const save = useMutation(api.agents.recipient.updateRecipientPreferences);
  const [prefs, setPrefs] = useState<Pref[] | null>(null);
  const [grants, setGrants] = useState<Record<Category, QuestionType[]> | null>(null);
  const [draft, setDraft] = useState<Pref>({ category: "interest", text: "", disclosable: true, authorized: true });
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();

  const saved = profile.value;
  const currentPrefs: Pref[] =
    prefs ??
    (saved?.preferences.map((p) => ({
      category: p.category,
      text: p.text,
      disclosable: p.disclosable,
      authorized: p.authorized,
    })) ??
      []);
  const currentGrants: Record<Category, QuestionType[]> =
    grants ??
    (Object.fromEntries(
      CATEGORIES.map((c) => [c, saved?.grants.find((g) => g.category === c)?.allowedQuestionTypes ?? []]),
    ) as Record<Category, QuestionType[]>);

  async function create() {
    setError(undefined);
    try {
      const res = await createProfile({ roomId });
      if (!res.ok) setError(res.error.message);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function onSave() {
    if (!saved) return;
    setError(undefined);
    setNote(undefined);
    try {
      const res = await save({
        recipientProfileId: saved.recipientProfileId,
        preferences: currentPrefs,
        grants: CATEGORIES.filter((c) => currentGrants[c].length > 0).map((c) => ({
          category: c,
          allowedQuestionTypes: currentGrants[c],
        })),
      });
      if (!res.ok) setError(res.error.message);
      else setNote("Saved. The recipient agent will use these on its next answer.");
    } catch (e) {
      setError(errorText(e));
    }
  }

  const toggleGrant = (c: Category, t: QuestionType) =>
    setGrants({
      ...currentGrants,
      [c]: currentGrants[c].includes(t) ? currentGrants[c].filter((x) => x !== t) : [...currentGrants[c], t],
    });

  return (
    <Panel title="Recipient agent (demo)">
      <p className="mb-2 text-xs font-medium text-coral">
        Synthetic demo — do not enter real private messages.
      </p>
      {profile.loading && <p className="text-sm text-plum-soft">Loading…</p>}
      {!profile.loading && !saved && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-plum-soft">No recipient profile yet.</p>
          <button type="button" onClick={create} className="self-start rounded bg-plum px-3 py-2 text-sm text-ivory">
            Create synthetic profile
          </button>
        </div>
      )}
      {saved && (
        <div className="flex flex-col gap-3 text-sm">
          <ul className="flex flex-col gap-1">
            {currentPrefs.map((p, i) => (
              <li key={i} className="flex items-start justify-between gap-2 rounded border border-plum/10 p-2">
                <span>
                  <span className="font-medium">{p.category}</span>: {p.text}{" "}
                  <span className="text-plum-soft">
                    ({p.authorized ? "authorized" : "not authorized"}, {p.disclosable ? "shareable" : "private"})
                  </span>
                </span>
                <button type="button" className="text-coral" onClick={() => setPrefs(currentPrefs.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </li>
            ))}
            {currentPrefs.length === 0 && <li className="text-plum-soft">No preferences yet.</li>}
          </ul>

          <div className="flex flex-col gap-2 rounded border border-plum/10 p-2">
            <div className="flex gap-2">
              <select
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value as Category })}
                className="rounded border px-2 py-1"
              >
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <input
                value={draft.text}
                maxLength={300}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                placeholder="e.g. Would love a beginner pottery class"
                className="min-w-0 flex-1 rounded border px-2 py-1"
              />
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.authorized} onChange={(e) => setDraft({ ...draft, authorized: e.target.checked })} />
              Authorized for the agent to use
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.disclosable} onChange={(e) => setDraft({ ...draft, disclosable: e.target.checked })} />
              Disclosable (may shape an answer)
            </label>
            <button
              type="button"
              disabled={!draft.text.trim()}
              onClick={() => {
                setPrefs([...currentPrefs, { ...draft, text: draft.text.trim() }]);
                setDraft({ ...draft, text: "" });
              }}
              className="self-start rounded border px-3 py-1 disabled:opacity-60"
            >
              Add preference
            </button>
          </div>

          <div>
            <p className="mb-1 font-medium">Who may ask what</p>
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th className="pr-2">Category</th>
                  {QUESTION_TYPES.map((t) => (
                    <th key={t} className="px-1 font-medium">{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CATEGORIES.map((c) => (
                  <tr key={c}>
                    <td className="pr-2">{c}</td>
                    {QUESTION_TYPES.map((t) => (
                      <td key={t} className="px-1">
                        <input
                          type="checkbox"
                          aria-label={`${c} may answer ${t}`}
                          checked={currentGrants[c].includes(t)}
                          onChange={() => toggleGrant(c, t)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button type="button" onClick={onSave} className="self-start rounded bg-coral px-4 py-2 text-white">
            Save profile
          </button>
          {note && <p className="text-plum-soft">{note}</p>}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-coral">{error}</p>}
    </Panel>
  );
}

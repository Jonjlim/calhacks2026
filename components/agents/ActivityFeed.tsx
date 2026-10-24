"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Panel } from "@/components/ui/Panel";
import { errorText, unwrap } from "@/lib/live/result";

const ACTOR_LABEL: Record<string, string> = {
  buyer: "Buyer agent",
  research_planner: "Research",
  recipient: "Recipient agent",
  extractor: "Extractor",
};

/** Real job and event states only; nothing here is derived from elapsed time. */
export function ActivityFeed({ roomId }: { roomId: Id<"rooms"> }) {
  const activity = unwrap(useQuery(api.agents.buyer.listActivity, { roomId }));
  const retry = useMutation(api.agents.buyer.retryJob);
  const [error, setError] = useState<string>();

  async function onRetry(jobId: string) {
    setError(undefined);
    try {
      const res = await retry({ jobId: jobId as Id<"agentJobs"> });
      if (!res.ok) setError(res.error.message);
    } catch (err) {
      setError(errorText(err));
    }
  }

  const events = activity.value?.events ?? [];
  const jobs = activity.value?.jobs ?? [];
  const active = jobs.filter((j) => ["pending", "running"].includes(j.status));
  const retryable = jobs.filter((j) => j.canRetry);

  return (
    <Panel title="Agent activity">
      {activity.loading && <p className="text-sm text-plum-soft">Loading…</p>}
      {activity.error && <p className="text-sm text-coral">{activity.error.message}</p>}
      {activity.value && !activity.value.capabilities.modelConfigured && (
        <p className="mb-2 rounded bg-coral/15 p-2 text-sm text-coral">
          No model is configured on this deployment, so agents cannot answer.
        </p>
      )}
      {active.length > 0 && (
        <p className="mb-2 text-sm text-plum-soft">{active.length} agent task(s) in progress…</p>
      )}
      {retryable.map((j) => (
        <div key={j.id} className="mb-2 flex items-center justify-between rounded border border-coral/40 p-2 text-sm">
          <span>A {j.kind.replace("_", " ")} task {j.status}.</span>
          <button type="button" onClick={() => onRetry(j.id)} className="rounded border px-2 py-1">
            Retry
          </button>
        </div>
      ))}
      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto text-sm">
        {events
          .slice()
          .reverse()
          .map((e) => (
            <li key={e.id} className={e.kind === "failed" ? "text-coral" : ""}>
              <span className="font-medium">{ACTOR_LABEL[e.actor] ?? e.actor}</span>{" "}
              <span className="text-plum-soft">· {e.kind}</span> — {e.summary}
            </li>
          ))}
        {activity.value && events.length === 0 && (
          <li className="text-plum-soft">No agent activity yet. Mention @unwrap or press Ask Unwrap.</li>
        )}
      </ul>
      {error && <p role="alert" className="mt-2 text-sm text-coral">{error}</p>}
    </Panel>
  );
}

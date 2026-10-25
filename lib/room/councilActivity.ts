import { COUNCIL_ACTORS, reduceCouncil, type CouncilActor } from "@/lib/council/contracts";
import type { JobStatus } from "@/lib/contracts";
import type { RoomData } from "@/components/room/types";
import { roomResearchJobs } from "./researchActivity";

/** Display-only projection of authorized live subscriptions. */
export function roomCouncilMembers(data: Pick<RoomData, "council" | "activity" | "researchJobs" | "latestResearch" | "trends">) {
  const events = data.council?.events ?? [];
  const members = reduceCouncil(events);
  const jobs: { actor: CouncilActor; status: JobStatus; createdAt: number; working: string; done: string; failed?: string }[] = [];
  for (const job of roomResearchJobs(data)) jobs.push({ ...job, actor: "scout", working: "Scouting…", done: "Gift search finished", failed: searchFailure(job.lastError) });
  // Trend lookups run on their own in the background. Their outcome shows on the trend ideas themselves;
  // a lookup that finds nothing or fails must not paint Scout as broken when its real work is fine.
  const trend = data.trends?.latestJob;
  if (trend && (trend.status === "pending" || trend.status === "running" || trend.status === "succeeded")) jobs.push({ ...trend, actor: "scout", working: "Exploring trends…", done: "Trend lookup finished" });
  for (const job of data.activity?.jobs ?? []) {
    const role = job.kind === "extract"
      ? { actor: "archivist" as const, working: "Reading memories…", done: "Memory reading finished" }
      : job.kind === "evaluate_thread"
        ? { actor: "muse" as const, working: "Thinking through gift ideas…", done: "Gift ideas reviewed" }
        : { actor: "courier" as const, working: "Asking about preferences…", done: "Preference check finished" };
    jobs.push({ ...job, ...role });
  }
  const active = (status: JobStatus) => status === "pending" || status === "running";
  const rank = (status: JobStatus) => active(status) ? 2 : status === "uncertain" ? 1 : 0;
  const statuses: JobStatus[] = ["pending", "running", "succeeded", "failed", "uncertain", "stale", "canceled"];
  for (const actor of COUNCIL_ACTORS) {
    const job = jobs.filter((j) => j.actor === actor).sort((a, b) => rank(b.status) - rank(a.status) || b.createdAt - a.createdAt)[0];
    if (!job) continue;
    const lastEvent = Math.max(0, ...events.filter((e) => e.actor === actor).map((e) => e.timestamp));
    if (!active(job.status) && (members[actor].status === "started" || lastEvent > job.createdAt)) continue;
    const status = active(job.status) ? "started" : job.status === "succeeded" ? "completed" : "failed";
    const summary = job.status === "pending" ? "Waiting to start…"
      : job.status === "running" ? job.working
      : job.status === "succeeded" ? job.done
      : job.status === "uncertain" ? "Waiting for confirmation…"
      : job.status === "stale" ? "Memories changed — try again"
      : job.status === "canceled" ? "Task canceled" : job.failed ?? "Task failed — try again";
    members[actor] = { actor, status, summary, sequence: job.createdAt * 8 + statuses.indexOf(job.status) };
  }
  return members;
}

/** What a failed gift search actually ran into, in plain words, instead of a bare "try again". */
export function searchFailure(lastError?: string): string {
  if (!lastError) return "Gift search failed — try again";
  if (/no usable product listings|no listings|no results/i.test(lastError)) return "No gifts matched that search — try another direction";
  if (/council service is not configured|FETCH_AGENT_URL/i.test(lastError)) return "The council isn’t connected on this server";
  if (/credentials|token|unauthori[sz]ed|401|403/i.test(lastError)) return "The gift source isn’t set up on this server";
  if (/timed? ?out|timeout/i.test(lastError)) return "The gift search took too long — try again";
  return "Gift search failed — try again";
}

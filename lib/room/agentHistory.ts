import type { CouncilActor } from "@/lib/council/contracts";
import type { RoomData } from "@/components/room/types";
import { roomResearchJobs } from "./researchActivity";

/** One thing a council member did, newest first when listed. Built only from stored events and jobs. */
export interface AgentHistoryEntry {
  id: string;
  at: number;
  status: "working" | "done" | "failed" | "waiting";
  title: string;
  detail?: string;
  /** How long it took, when both its start and its end were recorded. */
  durationMs?: number;
  source: "task" | "job";
}

const TASK_TITLE: Record<string, string> = {
  analyze_memories: "Read the memories",
  design_decoration: "Designed a memory charm",
  research_gifts: "Searched for real gifts",
  check_constraints: "Checked the budget and limits",
  deliver_recommendations: "Delivered the recommendations",
};

type JobLike = { _id?: string; id?: string; kind?: string; status: string; createdAt: number; lastError?: string | null; error?: string | null };

const JOB_ACTOR = (kind: string | undefined): CouncilActor => (kind === "extract" ? "archivist" : kind === "evaluate_thread" ? "muse" : "courier");
const JOB_TITLE: Record<string, string> = { extract: "Read a friend's shared messages", evaluate_thread: "Thought through gift ideas", ask_recipient: "Asked about preferences" };

/** Everything one member has done in this room, newest first: its council tasks (start and finish joined into one line with how long it took) and the background jobs that count as its work. */
export function agentHistory(data: RoomData, actor: CouncilActor): AgentHistoryEntry[] {
  const out: AgentHistoryEntry[] = [];
  const events = (data.council?.events ?? []).filter((e) => e.actor === actor);
  const byTask = new Map<string, typeof events>();
  for (const e of events) byTask.set(`${e.runId}:${e.task}`, [...(byTask.get(`${e.runId}:${e.task}`) ?? []), e]);
  for (const [key, group] of byTask) {
    const sorted = [...group].sort((a, b) => a.sequence - b.sequence);
    const start = sorted.find((e) => e.status === "started");
    const end = [...sorted].reverse().find((e) => e.status !== "started");
    const r = end?.result;
    const bits: string[] = [];
    if (r?.summary) bits.push(r.summary);
    if (r?.count !== undefined && !r.summary?.includes(String(r.count))) bits.push(`${r.count} found`);
    if (r?.cached) bits.push("from a recent search");
    if (r?.error) bits.push(r.error);
    out.push({
      id: key,
      at: end?.timestamp ?? start?.timestamp ?? 0,
      status: end ? (end.status === "failed" ? "failed" : "done") : "working",
      title: TASK_TITLE[sorted[0]!.task] ?? "Worked on a task",
      detail: bits.join(" · ") || undefined,
      durationMs: start && end ? Math.max(0, end.timestamp - start.timestamp) : undefined,
      source: "task",
    });
  }
  const jobs: { job: JobLike; title: string }[] = [];
  if (actor === "scout") {
    for (const j of roomResearchJobs(data)) jobs.push({ job: j as unknown as JobLike, title: "Gift search" });
    const t = data.trends?.latestJob;
    if (t) jobs.push({ job: t as unknown as JobLike, title: "Trend lookup" });
  }
  for (const j of (data.activity?.jobs ?? []) as unknown as JobLike[]) if (JOB_ACTOR(j.kind) === actor) jobs.push({ job: j, title: JOB_TITLE[j.kind ?? ""] ?? "Background task" });
  for (const { job, title } of jobs) {
    const failed = job.status === "failed" || job.status === "stale" || job.status === "canceled";
    out.push({
      id: `job:${job._id ?? job.id ?? job.createdAt}`,
      at: job.createdAt,
      status: job.status === "pending" ? "waiting" : job.status === "running" ? "working" : job.status === "uncertain" ? "waiting" : failed ? "failed" : "done",
      title,
      detail: job.status === "uncertain" ? "Waiting for confirmation" : job.status === "stale" ? "The memories changed, so it needs another try" : job.lastError ?? job.error ?? undefined,
      source: "job",
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

export function agoText(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export function durationText(ms: number): string {
  return ms < 1000 ? "under a second" : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)} min`;
}

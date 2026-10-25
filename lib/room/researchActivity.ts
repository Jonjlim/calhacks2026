import type { RoomData, ResearchJobRow } from "@/components/room/types";

export function roomResearchJobs(data: Pick<RoomData, "researchJobs" | "latestResearch">): ResearchJobRow[] {
  return data.researchJobs ?? (data.latestResearch ? [data.latestResearch] : []);
}

export function isResearchActive(job?: ResearchJobRow | null): boolean {
  return job?.status === "pending" || job?.status === "running";
}

/** Unfinished work cannot be hidden by a newer, already-completed search. */
export function relevantResearchJob(jobs: readonly ResearchJobRow[]): ResearchJobRow | undefined {
  const priority = (job: ResearchJobRow) => isResearchActive(job) ? 2 : job.status === "uncertain" ? 1 : 0;
  return [...jobs].sort((a, b) => priority(b) - priority(a) || b.createdAt - a.createdAt)[0];
}

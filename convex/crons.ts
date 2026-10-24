import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("sweep stale uploads", { minutes: 15 }, internal.cleanup.sweepStaleUploads, {});
export default crons;

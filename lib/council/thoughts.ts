import type { CouncilActor } from "./contracts";

/**
 * What each council member says while its task really is running: short phrases
 * for the role, taken in turn so a long task does not repeat one line. They are
 * only ever shown while the stored state says the task is started.
 */
export const WORKING_PHRASES: Record<CouncilActor, string[]> = {
  scout: ["Scouting gift ideas…", "Looking for better matches…", "Checking real listings…"],
  archivist: ["Sorting memories…", "Grouping shared clues…"],
  muse: ["Finding patterns…", "Linking ideas together…"],
  keeper: ["Balancing contributions…", "Checking the budget…"],
  courier: ["Preparing the next step…", "Gathering the results…"],
};

/** One plain line about what each member is for. */
export const ROLE_LINE: Record<CouncilActor, string> = {
  archivist: "Reads what friends shared and turns it into clear, checkable clues.",
  muse: "Looks for the pattern behind the clues and designs the little memory charms.",
  scout: "Searches for real gifts that fit, and records where each one came from.",
  keeper: "Checks every idea against the budget and the group's limits.",
  courier: "Gathers the results and delivers them to the room.",
};

export const thoughtFor = (actor: CouncilActor, turn: number) => WORKING_PHRASES[actor][turn % WORKING_PHRASES[actor].length]!;

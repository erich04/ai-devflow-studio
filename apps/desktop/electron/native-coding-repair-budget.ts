/** Scheduling guidance, not extra authorization or a larger execution limit.
 * The root's existing hard step/time/cost limits remain authoritative. */
export function codingRepairBudget(limits: { maxSteps: number; maxActiveMilliseconds: number }, usedSteps: number, usedMilliseconds: number, failedRevisions: number) {
  const repairRoundsRemaining = Math.max(0, 2 - failedRevisions)
  const reservedSteps = Math.floor(limits.maxSteps * 0.15) * repairRoundsRemaining
  const reservedMilliseconds = Math.floor(limits.maxActiveMilliseconds * 0.2) * repairRoundsRemaining
  return { repairRoundsRemaining, reservedSteps, reservedMilliseconds,
    stepsUntilSubmissionTarget: Math.max(0, limits.maxSteps - usedSteps - reservedSteps),
    millisecondsUntilSubmissionTarget: Math.max(0, limits.maxActiveMilliseconds - usedMilliseconds - reservedMilliseconds),
    instruction: 'Aim to submit a tested candidate before this target to leave room for host acceptance and repair. Near the target, stop broad exploration, finish focused edits/checks, and propose_changeset; if not ready, report the actual blocker. These are scheduling targets inside the existing hard limits, not additional budget or permission.' }
}

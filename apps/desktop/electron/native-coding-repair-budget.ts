/** Scheduling guidance, not extra authorization or a larger execution limit.
 * The root's existing hard step/time/cost limits remain authoritative. */
export function codingRepairBudget(limits: { maxSteps: number; maxActiveMilliseconds: number }, usedSteps: number, usedMilliseconds: number, failedRevisions: number) {
  // The first failed submission starts repair one; it does not consume it.
  // Report the current repair plus any later repair, but reserve only for
  // rounds after the candidate currently being prepared.
  const repairRoundsRemaining = Math.min(2, Math.max(0, 3 - failedRevisions))
  const laterRepairRounds = Math.max(0, 2 - failedRevisions)
  const reservedSteps = Math.floor(limits.maxSteps * 0.15) * laterRepairRounds
  const reservedMilliseconds = Math.floor(limits.maxActiveMilliseconds * 0.2) * laterRepairRounds
  return { repairRoundsRemaining, reservedSteps, reservedMilliseconds,
    stepsUntilSubmissionTarget: Math.max(0, limits.maxSteps - usedSteps - reservedSteps),
    millisecondsUntilSubmissionTarget: Math.max(0, limits.maxActiveMilliseconds - usedMilliseconds - reservedMilliseconds),
    instruction: 'Aim to submit a tested candidate before this target to leave room for host acceptance and repair. Near the target, stop broad exploration, finish focused edits/checks, and propose_changeset; if not ready, report the actual blocker. These are scheduling targets inside the existing hard limits, not additional budget or permission.' }
}

import { expect, it } from 'vitest'
import { codingRepairBudget } from './native-coding-repair-budget'

it('sets earlier submission targets inside the existing total limit and releases them per repair round', () => {
  expect(codingRepairBudget({ maxSteps: 80, maxActiveMilliseconds: 900000 }, 30, 300000, 0)).toMatchObject({
    repairRoundsRemaining: 2,
    reservedSteps: 24,
    reservedMilliseconds: 360000,
    stepsUntilSubmissionTarget: 26,
    millisecondsUntilSubmissionTarget: 240000,
  })
  expect(codingRepairBudget({ maxSteps: 80, maxActiveMilliseconds: 900000 }, 56, 540000, 1)).toMatchObject({
    repairRoundsRemaining: 2,
    reservedSteps: 12,
    stepsUntilSubmissionTarget: 12,
    millisecondsUntilSubmissionTarget: 180000,
  })
  expect(codingRepairBudget({ maxSteps: 80, maxActiveMilliseconds: 900000 }, 77, 850000, 2)).toMatchObject({
    repairRoundsRemaining: 1,
    reservedSteps: 0,
    stepsUntilSubmissionTarget: 3,
    millisecondsUntilSubmissionTarget: 50000,
  })
  expect(codingRepairBudget({ maxSteps: 80, maxActiveMilliseconds: 900000 }, 79, 890000, 3)).toMatchObject({
    repairRoundsRemaining: 0,
    reservedSteps: 0,
  })
})

it('reserves a measured final verification inside the earlier operator cutoff without increasing the activity allowance', () => {
  const late = codingRepairBudget({ maxSteps: 80, maxActiveMilliseconds: 900000 }, 27, 847000, 1, {
    wallRemaining: 12000,
    lastVerificationMs: 46933,
  })
  expect(late).toMatchObject({
    usableMilliseconds: 12000,
    lastVerificationMilliseconds: 46933,
    millisecondsBeforeFinalVerification: 0,
  })
  const atRepairStart = codingRepairBudget({ maxSteps: 80, maxActiveMilliseconds: 900000 }, 22, 796000, 1, {
    wallRemaining: 64000,
    lastVerificationMs: 46933,
  })
  expect(atRepairStart).toMatchObject({ usableMilliseconds: 64000, millisecondsBeforeFinalVerification: 17067 })
  const activeFirst = codingRepairBudget({ maxSteps: 80, maxActiveMilliseconds: 900000 }, 6, 895000, 1, {
    wallRemaining: 600000,
    lastVerificationMs: 1000,
  })
  expect(activeFirst.usableMilliseconds).toBe(5000)
})

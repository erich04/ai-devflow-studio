import { expect, it } from 'vitest'
import { codingRepairBudget } from './native-coding-repair-budget'

it('sets earlier submission targets inside the existing total limit and releases them per repair round', () => {
  expect(codingRepairBudget({ maxSteps: 80, maxActiveMilliseconds: 900000 }, 30, 300000, 0)).toMatchObject({ repairRoundsRemaining: 2, reservedSteps: 24, reservedMilliseconds: 360000, stepsUntilSubmissionTarget: 26, millisecondsUntilSubmissionTarget: 240000 })
  expect(codingRepairBudget({ maxSteps: 80, maxActiveMilliseconds: 900000 }, 56, 540000, 1)).toMatchObject({ repairRoundsRemaining: 1, reservedSteps: 12, stepsUntilSubmissionTarget: 12, millisecondsUntilSubmissionTarget: 180000 })
  expect(codingRepairBudget({ maxSteps: 80, maxActiveMilliseconds: 900000 }, 77, 850000, 2)).toMatchObject({ repairRoundsRemaining: 0, reservedSteps: 0, stepsUntilSubmissionTarget: 3, millisecondsUntilSubmissionTarget: 50000 })
})

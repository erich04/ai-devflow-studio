import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { BuildTestText } from './BuildTestTerms'
afterEach(cleanup)
it('gives keyboard-focusable terms their exact explanations while leaving raw material literal', () => {
  render(<BuildTestText text="在受管工作区运行基线，再准备 Draft PR。原文：受管工作区.ts" raw={['受管工作区.ts']} />)
  const term = screen.getByText('受管工作区', { exact: true })
  expect(term).toHaveAttribute('tabindex', '0')
  expect(term).toHaveAccessibleDescription('DevFlow 为这个任务单独准备的一份项目副本，你的项目目录不会被改。')
  expect(screen.getByText('受管工作区.ts')).toHaveAttribute('data-raw-material')
  expect(screen.getAllByRole('tooltip')).toHaveLength(3)
})

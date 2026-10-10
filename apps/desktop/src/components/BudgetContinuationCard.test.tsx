import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { DevFlowDesktopApi } from '../desktop-api'
import { BudgetContinuationCard } from './BudgetContinuationCard'
import { budgetContinuationFixture } from '../testing/budget-continuation-fixture'
afterEach(cleanup)
it('shows truthful bounds and requests consent only after an unchecked box is clicked', async () => {
  const card = budgetContinuationFixture()
  const api = { modelBudgetContinuation: vi.fn().mockResolvedValueOnce([card]).mockResolvedValue([]) } as unknown as DevFlowDesktopApi
  render(<BudgetContinuationCard api={api} />)
  const box = await screen.findByRole('checkbox')
  expect(box).not.toBeChecked()
  expect(screen.getByText(/累计费用上界/)).toHaveTextContent('36')
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  expect(api.modelBudgetContinuation).toHaveBeenCalledTimes(1)
  fireEvent.click(box)
  await waitFor(() => expect(api.modelBudgetContinuation).toHaveBeenCalledWith({ action: 'respond', id: card.id, expectedVersion: card.version, confirmed: true }))
  await waitFor(() => expect(screen.queryByRole('checkbox')).not.toBeInTheDocument())
})
it('keeps a newer event when the initial list response arrives late', async () => {
  let load!: (cards: ReturnType<typeof budgetContinuationFixture>[]) => void
  let update!: (cards: ReturnType<typeof budgetContinuationFixture>[]) => void
  const api = { modelBudgetContinuation: () => new Promise(resolve => { load = resolve }), onModelBudgetContinuationUpdated: (listener: typeof update) => { update = listener; return () => {} } } as unknown as DevFlowDesktopApi
  render(<BudgetContinuationCard api={api} />)
  await act(async () => { update([budgetContinuationFixture()]); load([]) })
  expect(screen.getByRole('checkbox')).toBeInTheDocument()
})

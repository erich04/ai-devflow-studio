import { act, fireEvent, render, screen } from '@testing-library/react'
import type { CSSProperties } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  calculateInspectorWidthBounds,
  WorkbenchSplitter,
  WORKBENCH_INSPECTOR_MAX_WIDTH,
  WORKBENCH_INSPECTOR_MIN_WIDTH,
} from './WorkbenchSplitter'

const layoutStyle = {
  '--workbench-run-list-width': '280px',
  '--workflow-board-min-width': '420px',
  '--workbench-splitter-width': '12px',
  '--inspector-width': '420px',
  columnGap: '12px',
  padding: '14px',
} as CSSProperties

function renderSplitter(initialContainerWidth = 1_400) {
  let containerWidth = initialContainerWidth
  const result = render(
    <section className="workbench-layout" style={layoutStyle}>
      <div className="run-list">Runs</div>
      <div className="workflow-panel">Workflow</div>
      <WorkbenchSplitter />
      <aside className="inspector">Inspector</aside>
    </section>,
  )
  const layout = result.container.querySelector<HTMLElement>('.workbench-layout')!
  const runList = result.container.querySelector<HTMLElement>('.run-list')!
  const splitter = screen.getByRole('separator')
  vi.spyOn(layout, 'getBoundingClientRect').mockImplementation(() => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: containerWidth,
    top: 0,
    width: containerWidth,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }))
  vi.spyOn(runList, 'getBoundingClientRect').mockImplementation(() => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 280,
    top: 0,
    width: 280,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }))
  vi.spyOn(splitter, 'getBoundingClientRect').mockImplementation(() => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 12,
    top: 0,
    width: 12,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }))

  act(() => window.dispatchEvent(new Event('resize')))

  return {
    layout,
    splitter,
    setContainerWidth(width: number) {
      containerWidth = width
      act(() => window.dispatchEvent(new Event('resize')))
    },
  }
}

function firePointerEvent(
  element: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  input: { pointerId: number; clientX: number },
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: input.clientX },
    pointerId: { value: input.pointerId },
  })
  fireEvent(element, event)
}

describe('WorkbenchSplitter', () => {
  it('calculates a bounded Inspector width from the actual Workbench space', () => {
    expect(calculateInspectorWidthBounds({
      containerWidth: 1_400,
      paddingInline: 28,
      runListWidth: 280,
      workflowMinWidth: 420,
      splitterWidth: 12,
      columnGap: 12,
    })).toEqual({ min: 320, max: 624 })

    expect(calculateInspectorWidthBounds({
      containerWidth: 4_000,
      paddingInline: 28,
      runListWidth: 360,
      workflowMinWidth: 520,
      splitterWidth: 12,
      columnGap: 12,
    })).toEqual({ min: 320, max: WORKBENCH_INSPECTOR_MAX_WIDTH })

    expect(calculateInspectorWidthBounds({
      containerWidth: 900,
      paddingInline: 28,
      runListWidth: 280,
      workflowMinWidth: 420,
      splitterWidth: 12,
      columnGap: 12,
    })).toEqual({ min: 320, max: WORKBENCH_INSPECTOR_MIN_WIDTH })
  })

  it('exposes separator semantics and supports keyboard resizing', () => {
    const { layout, splitter } = renderSplitter()

    expect(splitter).toHaveAttribute('aria-orientation', 'vertical')
    expect(splitter).toHaveAttribute('aria-valuemin', '320')
    expect(splitter).toHaveAttribute('aria-valuemax', '624')
    expect(splitter).toHaveAttribute('aria-valuenow', '420')

    fireEvent.keyDown(splitter, { key: 'ArrowLeft' })
    expect(splitter).toHaveAttribute('aria-valuenow', '444')
    expect(layout.style.getPropertyValue('--inspector-width')).toBe('444px')

    fireEvent.keyDown(splitter, { key: 'ArrowRight' })
    expect(splitter).toHaveAttribute('aria-valuenow', '420')

    fireEvent.keyDown(splitter, { key: 'Home' })
    expect(splitter).toHaveAttribute('aria-valuenow', '320')

    fireEvent.keyDown(splitter, { key: 'End' })
    expect(splitter).toHaveAttribute('aria-valuenow', '624')
  })

  it('expands the Inspector when dragged left and clamps it after a window resize', () => {
    const { layout, splitter, setContainerWidth } = renderSplitter()
    let capturedPointerId: number | null = null
    Object.defineProperties(splitter, {
      setPointerCapture: {
        value: vi.fn((pointerId: number) => {
          capturedPointerId = pointerId
        }),
      },
      hasPointerCapture: {
        value: vi.fn((pointerId: number) => capturedPointerId === pointerId),
      },
      releasePointerCapture: {
        value: vi.fn(() => {
          capturedPointerId = null
        }),
      },
    })

    firePointerEvent(splitter, 'pointerdown', { pointerId: 7, clientX: 900 })
    expect(splitter).toHaveClass('is-dragging')
    expect(document.body).toHaveClass('is-resizing-workbench')
    firePointerEvent(splitter, 'pointermove', { pointerId: 7, clientX: 800 })
    expect(splitter).toHaveAttribute('aria-valuenow', '520')
    expect(layout.style.getPropertyValue('--inspector-width')).toBe('520px')
    firePointerEvent(splitter, 'pointerup', { pointerId: 7, clientX: 800 })
    expect(splitter).not.toHaveClass('is-dragging')
    expect(document.body).not.toHaveClass('is-resizing-workbench')

    fireEvent.keyDown(splitter, { key: 'End' })
    expect(splitter).toHaveAttribute('aria-valuenow', '624')
    setContainerWidth(1_200)
    expect(splitter).toHaveAttribute('aria-valuemax', '424')
    expect(splitter).toHaveAttribute('aria-valuenow', '424')
    expect(layout.style.getPropertyValue('--inspector-width')).toBe('424px')
  })
})

import { useCallback, useEffect, useRef, useState } from 'react'

export const WORKBENCH_INSPECTOR_DEFAULT_WIDTH = 420
export const WORKBENCH_INSPECTOR_MIN_WIDTH = 320
export const WORKBENCH_INSPECTOR_MAX_WIDTH = 720

const WORKBENCH_SPLITTER_KEYBOARD_STEP = 24

type InspectorWidthBoundsInput = {
  containerWidth: number
  paddingInline: number
  runListWidth: number
  workflowMinWidth: number
  splitterWidth: number
  columnGap: number
}

export function calculateInspectorWidthBounds({
  containerWidth,
  paddingInline,
  runListWidth,
  workflowMinWidth,
  splitterWidth,
  columnGap,
}: InspectorWidthBoundsInput): { min: number; max: number } {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return {
      min: WORKBENCH_INSPECTOR_MIN_WIDTH,
      max: WORKBENCH_INSPECTOR_MAX_WIDTH,
    }
  }

  const availableWidth = Math.floor(
    containerWidth -
      paddingInline -
      runListWidth -
      workflowMinWidth -
      splitterWidth -
      columnGap * 3,
  )

  return {
    min: WORKBENCH_INSPECTOR_MIN_WIDTH,
    max: Math.max(
      WORKBENCH_INSPECTOR_MIN_WIDTH,
      Math.min(WORKBENCH_INSPECTOR_MAX_WIDTH, availableWidth),
    ),
  }
}

function clampWidth(width: number, bounds: { min: number; max: number }): number {
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, width)))
}

function readPixelValue(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function readInspectorWidthBounds(splitter: HTMLDivElement): { min: number; max: number } {
  const layout = splitter.parentElement
  if (!layout) {
    return {
      min: WORKBENCH_INSPECTOR_MIN_WIDTH,
      max: WORKBENCH_INSPECTOR_MAX_WIDTH,
    }
  }

  const styles = window.getComputedStyle(layout)
  const runList = layout.querySelector<HTMLElement>(':scope > .run-list')
  const runListWidth = runList?.getBoundingClientRect().width || readPixelValue(
    styles.getPropertyValue('--workbench-run-list-width'),
    280,
  )
  const splitterWidth = splitter.getBoundingClientRect().width || readPixelValue(
    styles.getPropertyValue('--workbench-splitter-width'),
    12,
  )
  const paddingInline =
    readPixelValue(styles.paddingLeft, 0) + readPixelValue(styles.paddingRight, 0)

  return calculateInspectorWidthBounds({
    containerWidth: layout.getBoundingClientRect().width,
    paddingInline,
    runListWidth,
    workflowMinWidth: readPixelValue(
      styles.getPropertyValue('--workflow-board-min-width'),
      520,
    ),
    splitterWidth,
    columnGap: readPixelValue(styles.columnGap, 12),
  })
}

type ActiveDrag = {
  pointerId: number
  startClientX: number
  startWidth: number
}

export function WorkbenchSplitter() {
  const splitterRef = useRef<HTMLDivElement>(null)
  const widthRef = useRef(WORKBENCH_INSPECTOR_DEFAULT_WIDTH)
  const boundsRef = useRef({
    min: WORKBENCH_INSPECTOR_MIN_WIDTH,
    max: WORKBENCH_INSPECTOR_MAX_WIDTH,
  })
  const activeDragRef = useRef<ActiveDrag | null>(null)
  const [inspectorWidth, setInspectorWidth] = useState(WORKBENCH_INSPECTOR_DEFAULT_WIDTH)
  const [bounds, setBounds] = useState(boundsRef.current)
  const [isDragging, setIsDragging] = useState(false)

  const applyInspectorWidth = useCallback((nextWidth: number, nextBounds = boundsRef.current) => {
    const clampedWidth = clampWidth(nextWidth, nextBounds)
    widthRef.current = clampedWidth
    setInspectorWidth(clampedWidth)
    splitterRef.current?.parentElement?.style.setProperty(
      '--inspector-width',
      `${clampedWidth}px`,
    )
  }, [])

  const refreshBounds = useCallback(() => {
    const splitter = splitterRef.current
    if (!splitter) {
      return boundsRef.current
    }

    const nextBounds = readInspectorWidthBounds(splitter)
    boundsRef.current = nextBounds
    setBounds(nextBounds)
    applyInspectorWidth(widthRef.current, nextBounds)
    return nextBounds
  }, [applyInspectorWidth])

  useEffect(() => {
    const splitter = splitterRef.current
    const layout = splitter?.parentElement
    if (!splitter || !layout) {
      return undefined
    }

    refreshBounds()
    const observer = new ResizeObserver(refreshBounds)
    observer.observe(layout)
    window.addEventListener('resize', refreshBounds)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', refreshBounds)
      layout.style.removeProperty('--inspector-width')
    }
  }, [refreshBounds])

  useEffect(() => {
    document.body.classList.toggle('is-resizing-workbench', isDragging)
    return () => document.body.classList.remove('is-resizing-workbench')
  }, [isDragging])

  const finishDrag = (pointerId: number) => {
    const activeDrag = activeDragRef.current
    if (!activeDrag || activeDrag.pointerId !== pointerId) {
      return
    }

    const splitter = splitterRef.current
    activeDragRef.current = null
    if (splitter?.hasPointerCapture?.(pointerId)) {
      splitter.releasePointerCapture(pointerId)
    }
    setIsDragging(false)
  }

  return (
    <div
      ref={splitterRef}
      className={`workbench-splitter ${isDragging ? 'is-dragging' : ''}`}
      data-testid="workbench-splitter"
      role="separator"
      aria-label="调整 Workflow Board 与 Inspector 宽度"
      aria-orientation="vertical"
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={inspectorWidth}
      aria-valuetext={`Inspector 宽度 ${inspectorWidth} 像素`}
      tabIndex={0}
      title="拖动调整 Inspector 宽度；也可使用左右方向键"
      onKeyDown={(event) => {
        const nextBounds = refreshBounds()
        if (event.key === 'ArrowLeft') {
          applyInspectorWidth(widthRef.current + WORKBENCH_SPLITTER_KEYBOARD_STEP, nextBounds)
        } else if (event.key === 'ArrowRight') {
          applyInspectorWidth(widthRef.current - WORKBENCH_SPLITTER_KEYBOARD_STEP, nextBounds)
        } else if (event.key === 'Home') {
          applyInspectorWidth(nextBounds.min, nextBounds)
        } else if (event.key === 'End') {
          applyInspectorWidth(nextBounds.max, nextBounds)
        } else {
          return
        }
        event.preventDefault()
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !Number.isFinite(event.clientX)) {
          return
        }
        refreshBounds()
        activeDragRef.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startWidth: widthRef.current,
        }
        event.currentTarget.setPointerCapture?.(event.pointerId)
        setIsDragging(true)
        event.preventDefault()
      }}
      onPointerMove={(event) => {
        const activeDrag = activeDragRef.current
        if (!activeDrag || activeDrag.pointerId !== event.pointerId) {
          return
        }
        applyInspectorWidth(
          activeDrag.startWidth + activeDrag.startClientX - event.clientX,
        )
      }}
      onPointerUp={(event) => finishDrag(event.pointerId)}
      onPointerCancel={(event) => finishDrag(event.pointerId)}
      onLostPointerCapture={(event) => finishDrag(event.pointerId)}
    >
      <span aria-hidden="true" />
    </div>
  )
}

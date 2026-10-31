import { memo, Profiler, useMemo, type ProfilerOnRenderCallback } from 'react'
import { ConversationBody, type DecorateBlock } from '../../ConversationBody'
import { sectionTitles } from '../../app/artifact-sections'

const headingLabel = (label: string) => sectionTitles[label] ?? label
let observeCommits: ProfilerOnRenderCallback | undefined
/**
 * Tests observe commits inside the material column ('gate-material') and inside each section
 * ('gate-material-section'), design §11 (NFR performance). Without an observer nothing is recorded.
 */
export function observeGateMaterialCommitsForTests(callback: ProfilerOnRenderCallback | undefined) {
  observeCommits = callback
}
export const onGateMaterialCommit: ProfilerOnRenderCallback = (...args) => observeCommits?.(...args)

/**
 * One section of the gate material. Memoised on its Markdown, offset and decoration, so hover,
 * adopting a finding (wide layout) or a new overlay never re-renders or re-parses it (§5.7).
 */
export const MaterialSection = memo(function MaterialSection({ markdown, start, decorate }: { markdown: string; start: number; decorate: DecorateBlock }) {
  const message = useMemo(() => ({ id: 'gate-material', role: 'assistant' as const, text: markdown, format: 'markdown' as const, createdAt: '' }), [markdown])
  return <Profiler id="gate-material-section" onRender={onGateMaterialCommit}>
    <ConversationBody showFormatToggle={false} headingLabel={headingLabel} decorateBlock={decorate} blockOffset={start} message={message} />
  </Profiler>
})

'use client'

import { useEffect } from 'react'
import { legacyAnchorTarget } from './studio-navigation'

/**
 * Old single-page links such as `/?projectId=X#runtime` pointed at sections that now live in
 * settings or the task list (plan S5, Q1). Hashes never reach the server, so they are mapped here.
 */
export function LegacyAnchorRedirect({ projectId }: { projectId: string | undefined }) {
  useEffect(() => {
    const anchor = window.location.hash.replace(/^#/u, '')
    if (!anchor || document.getElementById(anchor)) return
    const target = legacyAnchorTarget(projectId, anchor)
    if (target) window.location.replace(target)
  }, [projectId])
  return null
}

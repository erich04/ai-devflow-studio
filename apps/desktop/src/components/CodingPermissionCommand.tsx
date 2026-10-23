import type { CodingPermissionRequest } from '@ai-devflow/shared'

/** Keep the requested command visible for one-time approval, independently of session reuse. */
export function CodingPermissionCommand({ request }: { request: CodingPermissionRequest }) {
  if (!request.command) return null
  return (
    <div className="change-set-file">
      <h3>待授权命令</h3>
      <pre tabIndex={0} aria-label="待授权命令"><code>{request.command}</code></pre>
    </div>
  )
}

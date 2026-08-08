import type { TeamSession } from '@ai-devflow/shared'

export type RequestAuthentication =
  | { kind: 'session_cookie'; tokenRecordId: null }
  | { kind: 'desktop_bearer'; tokenRecordId: string }
  | { kind: 'development_header'; tokenRecordId: null }

export type RequestPrincipal = {
  session: TeamSession
  authentication: RequestAuthentication
}

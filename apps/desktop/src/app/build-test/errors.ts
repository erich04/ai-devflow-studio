import { describeProviderFailure, type CodingAgentRun, type CodingAgentEvent } from '@ai-devflow/shared'
const messages: Record<string, string> = {
  coding_context_invalid: '上一次开发的记录已经变化，这次没有开始。页面已刷新，请再试一次。',
  permission_settled: '这份请求已经处理过，这次没有重复处理。',
  permission_identity_changed: '页面上的改动和 DevFlow 记录的不一致，这次没有提交。请重新查看后再决定。',
  coding_permission_stale: '页面上的改动已经变化，这次没有提交。请重新查看后再决定。',
  revision_in_flight: '正在生成新版改动，现在不能批准或拒绝原来的改动。',
  revise_unsupported: '当前执行器不能按清单修改。清单保留；可以批准、拒绝或新开一次开发。',
  revise_in_flight: '已经在按清单生成新版本，这次没有重复提交。',
  revise_stale: '这份改动已经不是当前待批准的版本，修订清单没有提交。清单保留。',
  revise_expired: '这份改动已过期，不能再按清单修改。清单保留，可以重新开发。',
  revise_workflow_changed: '流程已经变化，修订清单没有提交。清单保留。',
  revise_workspace_unavailable: '受管工作区已不可用，不能按清单修改。清单保留，可以重新开发。',
  revise_limit_reached: '这次开发已经按清单修改了 3 次，不能再按清单修改。清单保留。',
  revise_budget_blocked: '预算不足或暂时无法核对，新版改动没有生成。清单保留。',
  revise_failed: '新版改动没有生成。清单保留，请查看当前版本的状态和期限后再试。',
  revise_stopped: '已停止生成新版改动。清单保留，请查看当前版本的状态和期限。',
  revise_run_ended: '生成新版改动期间，这次开发已结束。清单保留，可以重新开发。',
  revise_failed_expired: '新版改动没有生成，原改动也在生成期间过期了。清单保留，可以重新开发。',
  revise_state_changed: '生成期间运行记录发生了变化，新版改动没有保存。清单保留，页面已刷新。',
  review_not_allowed: '现在不能重新自检：改动已处理、已有自检进行中，或手动自检次数已用完。',
  workflow_changed: '流程已经变化，测试证据没有确认。页面已刷新，请再看一次。',
  test_node_not_current: '测试步骤已经不是当前步骤，测试证据没有确认。',
  test_evidence_not_latest: '有更新的测试报告，这次没有确认。请看最新的报告再确认。',
  test_evidence_stale: '测试证据已过期，没有确认。先重新运行测试。',
  test_evidence_unverifiable: '无法核实测试证据是否对应当前代码，没有确认。先重新运行测试。',
}
export function describeBuildTestError(error: unknown, action: string) {
  const technical = error instanceof Error ? error.message : String(error), code = technical.match(/\[([a-z_]+)\]/u)?.[1]
  const fields: Record<string, string> = { changeRequest: '修订文字', itemCount: '修改项数', comment: '理由', reason: '理由', expected: '改动身份', focus: '当前材料', expiresAt: '批准期限' }
  const text = code === 'invalid_input' ? `内容不符合要求（${fields[technical.split(']').at(-1)!.trim()] ?? '提交内容'}），这次没有提交。`
    : code && messages[code] ? messages[code]!
      : /current trusted project pairing/u.test(technical) ? '需要先完成当前项目的团队配对才能决定。'
        : /Session scope is only available|cannot be reused for the session|Session permission/u.test(technical) ? '这份请求不能在这次开发里复用，请用「允许一次」。'
          : /Latest Build Coding run is incomplete/u.test(technical) ? '现在不能运行测试：开发步骤的记录不完整。'
            : /managed Coding workspace is missing or inconsistent/u.test(technical) ? '受管工作区已不存在，不能运行测试。'
              : action === 'runTests' || action === 'rerunTests' ? '测试没有运行，请检查保存的测试命令和工作区后再试。'
                : `${action}没有完成，请重新读取后再试。`
  return { tone: code === 'revise_stopped' ? 'neutral' as const : 'error' as const, text, technical }
}
export function describeCodingRunFailure(run: CodingAgentRun, events: readonly CodingAgentEvent[]): string {
  const failed = [...events].filter(e => e.codingRunId === run.id).sort((a, b) => b.sequence - a.sequence).find(e => {
    const call = e.metadata?.providerCall
    return call && typeof call === 'object' && 'status' in call && call.status === 'failed'
  })?.metadata?.providerCall
  if (failed) return describeProviderFailure(failed as Parameters<typeof describeProviderFailure>[0])
  return run.status === 'timed_out' ? '开发超过了时限' : run.status === 'cancelled' ? '你停止了这次开发' : run.status === 'interrupted' ? '开发被中断（例如桌面应用重启）' : '执行器报告失败，详情在「执行记录」'
}

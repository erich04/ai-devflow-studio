import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const adrPath = join(
  process.cwd(),
  'docs/adr/0012-web-desktop-work-authority.md',
)

function readAdr(): string {
  return existsSync(adrPath)
    ? readFileSync(adrPath, 'utf8').replace(/\s+/gu, ' ')
    : ''
}

describe('ADR 0012 Web/Desktop work authority contract', () => {
  it('assigns versioned intake and commands to Team while Desktop owns the canonical full Run', () => {
    const adr = readAdr()

    expect(adr).toContain('# ADR 0012：Web 与桌面端的工作权限边界')
    expect(adr).toContain('Team 拥有带版本的 Work Request 和 Gate Command 记录')
    expect(adr).toContain('Desktop 拥有权威的完整本地 Run')
    expect(adr).toContain('显式认领')
    expect(adr).toContain('Team Run Projection')
    expect(adr).toContain('Web 绝不直接修改团队 Run 投影')
    expect(adr).toContain('不复制 Electron 工作流状态机')
  })

  it('turns a Web Gate action into an authenticated version-bound Desktop command lifecycle', () => {
    const adr = readAdr()

    expect(adr).toContain('已签名的浏览器 Session Cookie')
    expect(adr).toContain('配对的 Desktop Bearer Token')
    expect(adr).toContain('实时项目成员身份与角色')
    expect(adr).toContain('idempotency key')
    expect(adr).toContain('expectedRunVersion')
    expect(adr).toContain('expectedPolicyVersion')
    expect(adr).toContain('服务端预检')
    expect(adr).toContain('inbox → receipt → apply → acknowledgement')
    expect(adr).toContain('重新评估完整本地证据')
    expect(adr).toContain('只有之后的权威桌面摘要才能推进团队 Run 投影')
  })

  it('defines deterministic duplicate, concurrent, stale, expiry, and crash recovery semantics', () => {
    const adr = readAdr()

    expect(adr).toContain('同一幂等键和指纹重试同一操作会返回原始结果')
    expect(adr).toContain('同一键配不同指纹返回 `409 Conflict`')
    expect(adr).toContain('只允许一个活动命令')
    expect(adr).toContain('过期命令绝不投递或应用')
    expect(adr).toContain('stale_run')
    expect(adr).toContain('stale_policy')
    expect(adr).toContain('回执租约会过期')
    expect(adr).toContain('确认前已应用转换')
    expect(adr).toContain('绝不能重复应用状态转换')
    expect(adr).toContain('只有一个认领者成功')
  })

  it('requires an append-only redacted audit without uploading private repository content', () => {
    const adr = readAdr()

    expect(adr).toContain('采用仅追加审计')
    expect(adr).toContain('claim/release')
    expect(adr).toContain(
      '命令提交、服务端预检、回执、确认和过期',
    )
    expect(adr).toContain('绝不保存 Cookie、Bearer Token、API Key 或提供方凭据')
    expect(adr).toContain('有界允许列表投影')
    expect(adr).toContain(
      '原始仓库 Markdown、源文件、提示、stdout、stderr、补丁和本地绝对路径',
    )
    expect(adr).toContain('不上传本地仓库内容')
    expect(adr).toContain('## 未采用的替代方案')
  })
})

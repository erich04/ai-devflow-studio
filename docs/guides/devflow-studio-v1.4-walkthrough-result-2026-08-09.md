<a id="devflow-studio-v14-candidate-walkthrough-result--2026-08-09"></a>

# DevFlow Studio V1.4 候选版本演练结果 — 2026-08-09

<a id="outcome"></a>

## 结果

候选提交 `b7986d4faec2f8f1bcc220a0341cb0686286209e` 通过了完整的 V1.4 候选版本发布路径，包括无模型费用的本地矩阵、精确 SHA 的 PR CI、全新 GitHub OAuth 与桌面安装包电脑操作演练，以及单独授权的真实 OpenCode 服务商冒烟测试。

Web 到桌面的路径以桌面记录 `human_rejected` 结束。团队端将唯一 Gate 命令记为 `applied`、确认回执，并让规范 Run 停留在同一 Gate。本文不保留配对码、浏览器会话值、桌面 Bearer 值、服务商密钥、原始提示词/补丁/stdout/stderr、仓库路径或证据正文。

| 字段 | 观察结果 |
| --- | --- |
| 候选提交 | `b7986d4faec2f8f1bcc220a0341cb0686286209e` |
| 候选分支 | `codex/v1.4-release-signoff` |
| 包版本 | 六个第一方包均为 `1.4.0` |
| 桌面产物 | `darwin-arm64`，SHA-256 `5c0592e7c40ddc18fb7cd7e973489da999d0aee1cd1a07e2d54a09a39a812d6e` |
| 必需的确定性检查 | 本地矩阵与精确 SHA CI 覆盖的全部 11 个 V1.4 检查 ID 均通过 |
| 精确 SHA Verify | [运行 31320603242](https://github.com/erich04/ai-devflow-studio/actions/runs/31320603242)，五项作业通过 |
| 电脑操作演练 | 使用全新团队端和桌面状态，通过 |
| 真实 OpenCode 冒烟测试 | 通过一次，未自动重试 |

<a id="fresh-authority-and-computer-use-path"></a>

## 全新权限状态与电脑操作路径

演练从空 PostgreSQL schema v10 环境和全新 Desktop schema v12 存储开始，没有使用演示种子数据。GitHub OAuth 创建首位组织所有者，随后 Web 创建一个团队项目。Web 生成一个短期桌面配对码，直接输入桌面安装包界面，未写入日志、截图或持久化证据。配对码恰好消费一次，最终保留一个活动桌面配对。

界面路径完成了以下检查：

1. 桌面选择一个受控本地项目，配对到所选团队项目，并同步项目范围的 `remote_cache` Policy Snapshot v1。
2. Web 创建一个有界工作请求。领取前的即时检查显示：团队端存在一个 `open` v1 请求，没有已领取 Run 引用，团队 Run 投影为零。
3. 桌面恰好领取并创建一次 Run。请求变为 `materialized` v3，引用一个规范本地 Run 和一个脱敏团队投影。
4. 桌面生成澄清产物，将 Run 推进到 Gate。本地与团队投影均为 Run v2 / `paused_at_gate`。
5. Web 提交一次绑定版本及策略的拒绝。桌面取得精确回执，评估为 `human_rejected` 并确认，未推进 Run，也未修改 Run 版本。
6. Web 观察到命令终态，并确认 Run 仍停留在当前 Gate。

最终权威快照恰好包含一个工作请求、一个规范 Run 引用、一个团队 Run 投影、一个 Gate 命令、一个回执和一个确认。命令为 `reject` / `applied` / `human_rejected`；确认结果为 `human_rejected`，前后 Run 版本均为 2。范围内记录没有使用未签名的开发身份请求头。

没有从最终数据库快照推断“等待领取期间不存在团队 Run”这一过渡状态。演练在领取前即时记录了投影数量为零的检查点；等待领取时的竞态仍由已通过的确定性创建 Run 测试覆盖。

<a id="persistence-knowledge-and-trust-boundary-checks"></a>

## 持久化、知识与信任边界检查

完全退出桌面安装包后，使用同一隔离数据目录冷启动。配对、所选本地/团队项目、规范 Run、当前 Gate、策略快照、拒绝结果、回执观察、确认及持久化发件箱状态均已恢复。发件箱没有范围不匹配或已过期的发送租约，状态单调推进。

本地知识视图索引了两份 Markdown 文档，并为 Run 和 Gate 提供本地引用。团队端未保留知识引用载荷，也未报告 API 知识来源。对 266 个文本/JSON 列进行仅元数据的脱敏扫描，没有发现本地绝对路径或本地文件 URI 模式。远端产物、测试、编码和审查记录的不安全脱敏标记为零；全新演练存储中没有使用真实服务商的编码 Run。

审计后停止隔离桌面与 Compose 进程，将隔离文件根目录移到系统废纸篓，并删除其专用 Docker 卷。受保护的既有演练资源保持不变。

<a id="candidate-gates"></a>

## 候选版本检查

干净的 C9 检出按要求依次通过 `verify`、构建、构建输出冒烟测试、端到端测试、Electron 冒烟测试、桌面试点构建与打包冒烟测试、隔离 PostgreSQL 冒烟测试、Docker 冒烟测试和 Docker 生命周期冒烟测试。最终工作树与差异检查通过，各检查创建的临时资源已清理。精确 SHA 的 PR Verify 通过 macOS、Windows 兼容性、PostgreSQL 集成、Docker 和 Docker 生命周期五项作业。

<a id="release-only-real-opencode-smoke"></a>

## 仅用于发布的真实 OpenCode 冒烟测试

经授权、绑定候选版本的调用使用 OpenCode `1.18.15`、服务商 `double`、模型 `ark-code-latest` 和该候选版本拥有的 V1.4 Responses 配置。仅记录环境变量名 `ANTHROPIC_AUTH_TOKEN`。调用服务商前，无网络的最终配置预检通过。

实际冒烟测试耗时 21.037 秒，精确转发 `bash -> edit`。持有凭据的出口检查已启用，恰好转发并完成三个获得调用额度的片段。未获额度请求、无效请求、失败片段、活动连接和服务商重试状态均为零。唯一修改路径是仓库相对标记 `devflow-opencode-smoke.txt`；测试仓库用例、脱敏检查、受管工作树清理、进程组清理和临时根目录清理均通过。

获授权调用前，外层发布辅助程序曾在原子锁和服务商子进程启动前安全失败，原因是在查询本地加密记录前清除了 SQL.js 输入缓冲区。独立执行后检查确认 `attemptCount=0`，没有服务商进程、锁或运行时残留。该辅助程序位于候选目录之外；将缓冲区清理移至数据库关闭后，并重新逐字节审查。候选 C9 没有变化。因此，随后获授权的调用是该候选版本第一次且唯一一次顶层付费冒烟测试。

<a id="verdict"></a>

## 结论

上述绑定候选版本的确定性、跨平台、打包界面、权限、持久化、脱敏、清理和真实服务商检查均通过。本文是候选 C9 的发布证据；是否发布仍取决于仅含证据的直接子提交、其精确 CI 与打标签前 Release 运行、最终标签放行决定，以及标签触发的 Release 工作流。

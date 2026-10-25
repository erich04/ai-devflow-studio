# A 工作包真实验证准备（2026-10-23）

本页是验证计划与历史证据核对，**不是功能通过报告**。范围为 #248 失败诊断、#249 步骤恢复、#250 调查边界，以及 #201 / #202 的遗留现场。初始准备阶段仅只读核验；下列准备记录写于首次发送模型请求之前。后续真实验证、8 次调用费用、31 场景结算实验、最终构建重启及清理结果见 [实际验证报告](issues-a-live-validation-20261023.md)。

## 复用入口与隔离

- 本轮辅助入口 `node scripts/issues-a-live-environment.mjs preflight` 只读检查旧账本和端口；`start-team`、`start-electron`、`start-gateway` 分开显式执行，`stop` 按容器标签及 PID 起始时间核对后清理。网关脚本只实现首份 5 元额度，不自动打开第二份账本。
- Playwright CLI 驱动真实 Electron 的参考为 `output/playwright/automatic-memory-live/start-electron.sh`；旧 profile 仅作只读证据，不复用其中的 Provider、配对、账本、Hindsight bank 或用户会话。
- 新 profile / registry / 日志根目录为 `.tmp/issues-a-live-validation/`；UI 证据放在 `output/playwright/issues-a-live/`。应用使用正常 `safeStorage`，不替换 `fetch` 或模型响应。
- 建议端口：API 15310、Web 15311、独立 PostgreSQL 16432、Electron CDP 19522、模型预算网关 8892。启动时再次检查监听占用；有占用即停，不接管原进程。
- 创建专属 PostgreSQL 16 容器、随机口令和会话密钥，仅以 0600 文件保存。按当前 README 执行迁移，启用 `DEVFLOW_LOCAL_AUTH_ENABLED` / `DEVFLOW_REQUIRE_AUTH`，关闭 demo data / fake runtime / `DEV_AUTH_ENABLED`。Web 登录、项目、配对、Provider 设置走真实 UI。
- 使用新复制并提交的合成 Todo 仓库。原生目录选择器若仍无法自动化，先停 Electron，使用产品的目录检查与 `upsertProject` 注册；记录前后各表摘要，明确唯一允许变化为 `local_projects`，随后 UI 操作不得预写模型、配对、对话或流程数据。
- 本轮无需重新启用 Hindsight 的收费模型。8890 / 9990 的现有待机服务及其他工作包的服务均保持原样；已有 Memory 逻辑通过范围回归覆盖。

## 费用边界

用户授权总额为人民币 20 元。A 包新增上限 8 元，B 包预留 8 元；之前费用与未知调用预留合计 2.639110 元，仍保留 1.360890 元余量。不能将 20 元当作每包额度。

2026-10-23 对三个旧 ledger 只读核验结果：

| Ledger | 请求 | 已确认及保守预留（元） | 状态 |
| --- | ---: | ---: | --- |
| `.tmp/hindsight-deepseek-validation/budget/ledger.json` | 7 | 0.050602 | closed |
| `.tmp/hindsight-fullchain-validation/budget/ledger.json` | 76 | 1.552694 | closed |
| `.tmp/automatic-memory-live-validation/budget/ledger.json` | 61 | 1.035814 | closed；含一次 0.146008 元未知预留 |

三个 SHA-256 分别为 `be1fe80f44376df3f0a8342c8221074181f6648005d9bf323379e443cb8ecf54`、`2a44c4b5ec69f741ab239df567aadce527e333bb29704909edc8a02546bbb1f7`、`6c693558997b624d959e6e5fa5ecb193ce0fa88bb652b02e962d072cac91eea4`。不得重新打开、清零或删除未知预留。

复用 `deploy/hindsight/budget_gateway.py`，只读挂载此前授权的 DeepSeek 凭据文件，命令与日志不包含密钥。该工具每份账本硬上限为 5 元，因此：

1. 独立创建 A-1 账本，上限最多 5 元；启动前验证官方费率仍被现有保守报价覆盖。
2. 若确需更多调用，先关闭 A-1 并停止其网关，再创建 A-2；上限取 `min(3 元, 8 元 − A 已计费用及未知预留)`，不得并行启用两份授权。
3. 每个真实场景之前和之后保存 `/budget` 快照。未知请求按保守预留占用，不因重试而释放。结束关闭新账本并核验旧哈希。

现网关固定 `deepseek-flash`、`thinking=disabled`、`stream=false`、最多 8,192 输出 tokens、128 KiB 请求。它可以证明真实提供方执行，但**不能证明官方端点的思考、SSE、自动长度扩容或内置代理计价**。本地 URL 的模型能力/价格识别也不能冒充官方端点。应用内预算若因未知本地代理价格无法估算，可在专属测试项目经正常 UI 明确配置，再以真实网关硬上限约束；报告需注明两种预算边界。

## 验收场景与证据

### 正常真实请求

1. 在 UI 配置已授权的 DeepSeek 网关，创建全新会话，提出需要读取合成 Todo 文档/代码的有限调查问题。
2. 核对当前目标、已执行步骤、工具来源、完成答复以及用量记录。界面截图、会话 ID、turn / step / cycle、网关调用数与本地持久化记录对应。
3. 新增一个无工具简短问题，确认调查配置不强制调用工具，不泄露上轮来源，不改变正常最终答复。

### #248 失败诊断

- 在一次正常真实调用后，核对可见的请求与响应元数据；实际未出现错误时不能制造“真实模型格式失败”结论。
- 网络/格式/用量丢失等低概率分支通过**单独标记的故障注入**验证，可运行在真实 Electron / IPC / SQLite / Postgres 上，但本地模拟响应不计入真实模型样本。
- 每次实际请求保留 turn、step、cycle、尝试序号、结束原因、格式分类、恢复决策及费用状态；界面展开/复制/重启后仍能核对。日志不记录认证头、密钥或思考正文。
- 若真实模型恰好发生格式失败，保存合成文本的脱敏响应与请求结构，然后从相同解析入口离线重放；没有失败正文就不猜测 JSON 修补规则。

### #249 步骤恢复

- 一次已成功查材料的调查中，在后续步骤注入有界的暂时网络失败，观察步骤自己的首次加两次恢复额度、每次费用和失败历史。
- 恢复耗尽后通过 UI 继续：同一 user 消息不重复插入，成功材料不重复读，失败步骤开启新 cycle。再次恢复成功后后续独立步骤获得自己的额度。
- 取消、应用重启及仓库内容变化分别检查：取消不新增请求；重启能读历史和继续；来源变化必须重新核验。
- 需覆盖关键提案整个恢复组不能靠补查询无限重置；这是确定性回归项，不强求真实模型随机走出该分支。

### #250 调查边界

- 从 UI 设置小步数，真实模型发起多步调查；达到上限后应进入已定义的终止/总结流程，展示已知、未知、原因和下一步选项，且没有额外无界查询。
- 重复查询无进展使用可审计的固定模型响应夹具验证，确保重复计数按语义稳定的工具和参数计算；不同查询不得误判为死循环。
- 最大步数、时间与恢复额度分开记录；当前步骤的有界恢复不能被软时间边界截断，下一步不能悄悄越界。总结调用本身必须计费、受限、可取消。

### #201 / #202

- 正常真实需求/设计审查完成一轮即可，结合新诊断检查恢复与用量；无失败样本时不为了历史偶发问题继续反复刷模型。
- 结算网络故障采用明确的隔离代理/测试服务故障，核对有效模型结果仍保存、费用标为 pending、恢复后只重传费用，不再次生成；同一时间线记录 Electron close / closed、render-process-gone、WebContents destroyed、主进程退出和测试清理。
- 故障注入与清理事件分开；正对照主动关闭/崩溃仅证明采集有效，不能当成历史事故复现。

## 历史证据核对

GitHub 于 2026-10-23 查得：[#201](https://github.com/erich04/ai-devflow-studio/issues/201)、[#202](https://github.com/erich04/ai-devflow-studio/issues/202) 仍开放；[PR #235](https://github.com/erich04/ai-devflow-studio/pull/235) 于 2026-10-11 合入，merge commit 为 `b6ca31e2e85359d0ddcbcc3937320030eb517c5d`。

- #201 的两次原始坏正文没有保留。10 月 6 日 25 次真实 DeepSeek 复查得到 24 份有效审查和 1 次响应读取连接故障，没有重现格式失败；不能从 `finish_reason=stop` 推断截断，也不能因多次成功宣布已修复。
- #202 的 31 组实验包含 61 次本地合成请求，覆盖 503、连接中断、提交后回执丢失、延迟、读体中断和取消，没有复现窗口关闭。这些不是收费模型验收。
- **旧 H6 脚本的“结算失败不保存设计/不推进”预期已经过时。** #235 已改为保留有效模型结果和 pending 财务状态，只重放已保存账本。复用 `scripts/hardening-settlement-electron.mts` 前必须对齐新语义；不能把旧预期失败当作本轮产品回归，也不能略过账目/窗口检查。
- #235 已交付有界格式恢复、逐次诊断和结算恢复；其本地模型夹具、真实 OpenCode 进程与真实 Postgres 验收不等于历史 DeepSeek 故障已经归因。

依据：[历史复查](issue-201-202-reinvestigation-20261006.md)、[H6](h6-settlement-electron-20261004.md)、主干 `docs/validation/open-issues-resolution-20261010.md` 与 `docs/adr/0027-request-recovery-and-budget-continuation.md`。最终报告应区分已验证行为、注入故障以及仍缺现场的历史根因，不自动关闭这两个 issue。

## 清理与交付

只停止本次创建且 PID / 进程命令 / 容器标签匹配的服务；保留脱敏证据，关闭 A 账本，移除本次独立 Postgres 容器与卷。原用户项目、旧三份账本、Hindsight 待机服务、B 工作包容器/端口均不触碰。最后报告实际支出及未知预留、真实成功/失败次数、注入分支和任何未覆盖项。

## 已执行的环境准备

2026-10-23 16:12 UTC 起，独立 PostgreSQL / API / Web / gateway 均正常启动。容器为 `devflow-issues-a-1792771973631-postgres` 与 `devflow-issues-a-1792771973631-gateway`，标签 `devflow.validation=issues-a-1792771973631`；本轮 manifest 位于 `.tmp/issues-a-live-validation/runtime.json`。迁移输出为 `Team schema v32; applied 26 migration(s) and 191 statement(s).`，数据库真实持久化，无演示种子数据。

Web 已通过正常 UI 本地身份登录并创建合成项目 `p-issues-a-live-todo`。由于代理 URL 没有内置定价，专属项目经 UI 保存了停用的应用内金额预算；真实费用由独立 gateway 的 5 元不可重置账本限制。此设置仅影响该新建测试项目，不代表内置代理定价已通过。

新复制的合成 Git 仓库为 `output/playwright/issues-a-live/todo`，注册项目 `local-c07c5305615e`。按上述目录选择器例外，在 Electron 已停止后调用产品入口，只改变 `local_projects`；证据为同目录 `repository-registration-evidence.json`。首次 Electron 发现现有 `dist` 仍是上一轮构建，已停止；该次启动仅用于生成空 profile，不计入本轮最终功能验收。

[DeepSeek 官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) 于启动时核验：`deepseek-flash` 峰时每百万 tokens 未缓存输入 2 元、缓存输入 0.04 元、输出 8 元。当前网关保守按未缓存输入结算，可覆盖该公开费率。`budget-initial.json` 记录 0 调用、0 元、0 unknown。后续实际调用及最终状态必须另行补充。

脚本语法检查、preflight、`tsconfig.hardening-smoke.json` 类型检查和所改文件的空白错误检查已通过。Playwright CLI 连接 CDP 首次受本机代理环境影响返回 502，给该工具进程配置 `NO_PROXY=127.0.0.1,localhost` 后连接成功；未为此修改应用网络路径。

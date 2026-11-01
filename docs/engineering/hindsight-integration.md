# Hindsight 接入与验证

实现依据：[全阶段方案](../plans/hindsight-fullchain-2026-10-20.zh-CN.md)、[首期复审方案](../plans/hindsight-integration-v2-2026-10-20.zh-CN.md)、[ADR 0027](../adr/0027-selected-hindsight-projections.md)。

## 现在可以做什么

在 Electron「知识」页打开 Hindsight 设置。未配对项目需有任务且本地用户身份唯一。配对项目由当前配对用户重新明确授权本机私有知识投影；配置绑定组织、团队项目、本地项目、用户和认证账号。身份改变后撤销，普通 Token 轮换保留配置。

1. 把 [示例模型](../examples/hindsight/model.json) 复制为目标项目实际知识目录下的 `model.json`（默认 `docs/knowledge/model.json`），按业务修改标签/枚举，然后 `git add`。
2. 将待选 Markdown 纳入 Git，刷新知识目录，在面板选择不超过 20 篇。未配对项目可以另选本人项目私有正式记忆；配对项目不开放正式记忆投影。
3. 保存服务地址与可选 API Key，明确选择是否允许该项目同步。密钥加密保存，不返回渲染端。
4. 默认网络闸门关闭：可以核验本地来源、保存同步任务、使用选中文档的本地词法搜索，不会调用 Hindsight。讨论使用 `knowledge_search`，结果携带 `knowledge_read` 回读参数。阶段 Agent、各阶段知识评审和编码自动构造有界查询，将核验后的原文摘录放入模型提示。
5. 停止使用会立即撤销旧投影的本地可用性，保留异步清理状态。不要把“停止使用”解释为远端所有数据已经删除。

模型文件没有 endpoint、凭据和权限字段。`map` 提取的是独立标签路径；name 和 statement 不能按顺序或共现拼成正式业务规则对象。模型与来源更改触发重新核验，不改变审批规则。

需求澄清、设计及修订支持 Direct/OpenCode；编码支持 Native/OpenCode，分析、初始实现、权限继续和修复共用对应运行的简报。检索正文最多 6 KiB，实际渲染段最多 8 KiB；编码在原有总预算内为检索尽力预留最多 4 KiB，优先压缩可选叙述；完整已批准工件、Memory、当前请求与明确约束仍优先，确无空间时省略检索。其他阶段保留既有预算与必需输入。回执只记录真正送出的来源。召回最多等待五秒，控制请求仍为两秒；远端超时回退到当前本地词法，记录 `degraded`。

模型派发前、返回后和保存前检查引用；OpenCode 各内部模型轮次也检查。知识修订、撤销或身份变化会阻止旧上下文继续生效，已发生的模型费用仍结算。编码恢复不在旧运行中替换简报。测试命令只运行已配置的项目命令，另记录执行时的知识来源并在执行前后核验；没有新增“测试命令 LLM”。交付和验收使用各自既有评审入口，知识不能替代审批、实际测试或远端交付。

私有检索回执仅存本地；团队评审摘要剥离该字段。现有流程产物仍按原有规则同步，不因此获得新的知识原文同步通道。

## 启动独立本地服务

需要已启动的 Docker Desktop / Docker Engine 与 Compose。在仓库根目录执行一次：

```sh
cp deploy/hindsight/.env.example deploy/hindsight/.env
corepack pnpm hindsight:up
corepack pnpm hindsight:status
```

已经配置过 `.env` 时不要再次复制覆盖。该文件被 Git 忽略，只在本机填写中继令牌。

- DevFlow 服务地址：`http://127.0.0.1:8890`；Hindsight 管理界面：`http://127.0.0.1:9990`。
- Compose 项目名 `devflow-hindsight`，数据卷 `devflow-hindsight_data-multilingual-e5-small`，不挂载业务目录、不复用其他服务的数据库。
- 镜像 `devflow-hindsight:1.0.0-multilingual-e5-small` 在本机构建（`deploy/hindsight/Dockerfile`）：上游 1.0.0 的多架构摘要 `sha256:a88678c038b0e4340822b02a5efc566c56d8176b5bffa731bc433fd37f978e4c`，加多语言 embedding 模型 [`intfloat/multilingual-e5-small`](https://huggingface.co/intfloat/multilingual-e5-small)（修订 `614241f622f53c4eeff9890bdc4f31cfecc418b3`，每个文件按 `multilingual-e5-small.sha256` 校验）。首次 `hindsight:up` 构建镜像，下载约 490 MB；网络访问不了 Hugging Face 时，在 `.env` 设置 `DEVFLOW_HF_ENDPOINT` 为镜像站，文件仍要通过同一校验。运行时离线。重排模型仍是上游镜像自带的英文 `cross-encoder/ms-marco-MiniLM-L-6-v2`，只有仓库知识 bank 使用，项目记忆 bank 关闭重排（[项目记忆](project-memory.md)）。稳定 worker ID 支持重启时识别已有任务。
- `corepack pnpm hindsight:stop` 停止服务并保留数据，再执行 `hindsight:up` 恢复。不要使用 `down -v`，除非确实要删除该服务的全部数据。
- 此配置只绑定本机回环地址，适用于个人开发机；没有配置远程访问所需的认证和 TLS。

Hindsight 不持有 Provider 密钥。抽取和归纳的模型调用发往桌面端的记忆模型中继（`http://host.docker.internal:8891/v1`），中继按调用计入已配对团队项目的预算，再用项目保存的 Provider 转发，见 [ADR 0030](../adr/0030-hindsight-project-memory.md) 和[项目记忆](project-memory.md)。`.env` 的 `DEVFLOW_MEMORY_RELAY_TOKEN` 留空时，所有模型调用都被中继拒绝，不产生费用，**健康检查成功不代表记忆写入已可用**。

配置令牌前可运行 `corepack pnpm test:hindsight-local`：它检查实际运行镜像与独立数据卷，通过正式 HTTP 适配器配置空测试 bank，停止/重新启动这个专用服务，验证配置持久化并删除测试 bank。这个测试不写记忆、不调用模型；为避免重启已配置的模型 worker 造成费用，它只接受未设置中继令牌（或旧的不可达模型地址）的配置。

要启用抽取，把桌面端的中继令牌写入 `.env` 并重新执行 `hindsight:up`。中继只放行已开启项目记忆的已配对项目，以及该项目当前的仓库知识 bank；其他 bank 的调用返回 403。服务启动命令不自动开启 Electron 的网络闸门，也未实现由桌面程序自动安装和管理 Docker。

### 从英文模型的数据卷迁移

此前的部署用上游镜像自带的英文 embedding（`BAAI/bge-small-en-v1.5`），数据在 `devflow-hindsight_data`。Hindsight 不记录向量出自哪个模型，两个模型的向量维度又相同（384），混在一个库里不会报错，召回会静默变差，所以多语言模型使用新的数据卷，旧卷原样保留、不再使用。要保留旧数据，先关闭桌面端，再执行：

```sh
corepack pnpm hindsight:up
corepack pnpm hindsight:migrate
```

脚本用上游镜像在 `127.0.0.1:8896` 临时打开旧卷（不连接任何模型服务），用 Hindsight 的 bank 导出把每个 bank 存到 `out/hindsight-migration/<时间>/`，再以恢复模式导入当前服务。导出不含向量，导入时用当前模型重新计算，不调用模型。当前服务里已有记忆的同名 bank 不会被覆盖；桌面端启动时建的空 bank 会被替换。输出列出每个 bank 迁移前后的文档数和各类记忆数，不一致时退出码为 1。旧卷里仍在排队的抽取、归纳和知识页刷新不会迁移；记忆的 Hindsight id 会变，旧回执里的 `pm-<id>` 只作记录。桌面端重新启动后给项目记忆 bank 写入当前的召回设置。确认无误后可以用 `docker volume rm devflow-hindsight_data` 删除旧卷。

## 协议基线

- 上游：`vectorize-io/hindsight`，发布标签 `v1.0.0`，提交 `39c65ffe2f140d0c84cee58566cad8900c5b9908`。
- [固定 OpenAPI](https://github.com/vectorize-io/hindsight/blob/39c65ffe2f140d0c84cee58566cad8900c5b9908/hindsight-docs/static/openapi.json) 下载文件 SHA-256：`8ac3fbc2eb2796c32109fd1ad016cb8f8de43c0934d87a89910bd8478e42c55d`。
- 手写最小 HTTP 适配器，未引入 SDK；写入前检查 `/version` 的 `api_version=1.0.0`。版本字符串不是镜像/提交真实性证明，部署仍须固定镜像 digest 或上述源码提交。
- 首轮实现使用假响应/假提供方、真实 Git/文件和隔离 SQLite；后续已部署独立服务，通过 `chunks`、真实 DeepSeek `concise` / `verbatim` 基础协议及中文宿主链路检查，见[本地部署验证](../validation/hindsight-local-deployment-20261020.md)和[真实模型验证](../validation/hindsight-deepseek-validation-20261020.md)。项目记忆的中英文召回排序见[多语言召回验证](../validation/project-memory-multilingual-20261029.md)；仓库知识的跨语言排序与完整启用验收仍待完成。

部署者完成约定的固定版本协议验证、提供方/模型/范围/预算确认后，才设置 `DEVFLOW_HINDSIGHT_PROTOCOL_VERIFIED` 为上述提交 SHA，启动 Electron 并在项目中明确启用。此环境变量是人工部署确认，不能代替验证记录。

服务端还需启用 `HINDSIGHT_API_ENABLE_BANK_CONFIG_API=true` 并授予专用身份相应 bank 的配置、写入、召回与删除权限；本接入依赖该 API 核实标签及关闭自动归纳。固定版本在此 API 关闭时返回 404，适配器会停止提交来源。[上游配置路由](https://github.com/vectorize-io/hindsight/blob/39c65ffe2f140d0c84cee58566cad8900c5b9908/hindsight-api-slim/hindsight_api/api/http.py#L9073)

## 测试入口

本地正确性：

```sh
corepack pnpm exec vitest run \
  apps/desktop/electron/hindsight-client.test.ts \
  apps/desktop/electron/hindsight-source.test.ts \
  apps/desktop/electron/hindsight-store.test.ts \
  apps/desktop/electron/hindsight-service.test.ts \
  packages/shared/src/hindsight.test.ts \
  apps/desktop/src/components/HindsightPanel.test.tsx
corepack pnpm verify
corepack pnpm test:hindsight-electron
```

另有既有 `coding-context`、`coding-run-memory`、`local-store`、讨论工具、MCP、preload 等测试覆盖接线和回归。MCP 测试需要本机回环监听权限，文件夹具均为专用临时目录。

`test:hindsight-electron` 构建桌面后启动真实 Electron，使用隔离的数据目录和合成 Git 仓库，检查界面选择、宿主范围、默认关闭网络、持久化重启、源文件刷新和模型变更停用。它强制清空网络闸门，不调用 Hindsight 或模型。

真实服务的合成数据基础检查脚本：

```sh
corepack pnpm exec tsx scripts/hindsight-protocol-smoke.mts
```

执行前需明确配置 `HINDSIGHT_SMOKE_ENDPOINT`、可选 `HINDSIGHT_SMOKE_API_KEY`，并仅在本次服务/模型/费用已获准后设置 `HINDSIGHT_SMOKE_AUTHORIZED=1`。脚本只用合成文本，生成独立测试 bank/document/operation，不读业务文件。它检查版本、bank 配置、异步提交、同 operation 重放、来源 metadata 回传和删除后召回；完成后再次清理测试文档，保留空测试 bank。未完成的 operation 会输出清理标识，不能声称已经清理。

默认抽取模式为 `concise`；可通过 `HINDSIGHT_SMOKE_EXTRACTION_MODE` 选择 `concise`、`verbatim` 或 `chunks`。在上述默认本地部署下，以下命令可验证不计费的真实存储协议：

```sh
HINDSIGHT_SMOKE_AUTHORIZED=1 \
HINDSIGHT_SMOKE_ENDPOINT=http://127.0.0.1:8890 \
HINDSIGHT_SMOKE_EXTRACTION_MODE=chunks \
corepack pnpm test:hindsight-protocol
```

固定版本的 `chunks` 模式[跳过 LLM 抽取](https://github.com/vectorize-io/hindsight/blob/39c65ffe2f140d0c84cee58566cad8900c5b9908/hindsight-api-slim/hindsight_api/engine/retain/fact_extraction.py#L3537)，本地 Compose 的 embedding/reranker 也在本机运行。此模式通过不代表 `concise` 的实体、标签抽取已经验证；如果指向其他配置了收费 embedding/reranker 的服务，不能据此宣称免费。

该脚本**不是完整上线验收**：取消中的迟到写入、全部抽取模式/labels 的兼容性、实际计费幂等、派生数据清理以及约 30 题价值评估仍需另外保留证据。它不会自动打开桌面网络闸门。

### 有费用上限的 DeepSeek 合成验证

`deploy/hindsight/compose.deepseek-test.yaml` 是显式启用的测试覆盖配置，使用至多人民币 5 元账本，只允许 `deepseek-flash`。`DEVFLOW_HINDSIGHT_TEST_BUDGET_MICROYUAN` 可将新账本上限调小（1 元 = 1,000,000 微元），已有账本上限不可通过环境变量放大。它没有接入业务预算系统，也不是生产网关。

1. 在获得本次费用授权后，为实验准备 Git 忽略目录中的 `compose.env`，设置 `DEVFLOW_HINDSIGHT_GATEWAY_UID` / `GID`（凭据文件的所有者）、`DEVFLOW_HINDSIGHT_TEST_STATE_DIR`（独立账本目录绝对路径）与 `DEVFLOW_HINDSIGHT_DEEPSEEK_KEY_FILE`（现有已授权凭据的绝对路径）。文件写权限限制为本人；不把密钥内容填进这个文件。
2. 运行 `DEVFLOW_HINDSIGHT_TEST_AUTHORIZED=1 GATEWAY_STATE_DIR=<独立账本目录> python3 deploy/hindsight/budget_gateway.py --initialize`。已有账本会拒绝覆盖；不要删除、重置或重新打开旧账本来延续一次已结束的费用授权。延续同一累计授权时，先核算旧账本已发生/保留金额和摘要，仅以剩余额度初始化新账本，并在初始化、Compose 运行和关闭时设置相同的微元上限；不能再开一个完整 5 元额度。
3. 使用基础 Compose 和测试覆盖文件一起启动，额外传入上述 `compose.env`：

```sh
docker compose --env-file deploy/hindsight/.env \
  --env-file .tmp/hindsight-deepseek-validation/compose.env \
  -f deploy/hindsight/compose.yaml \
  -f deploy/hindsight/compose.deepseek-test.yaml \
  up -d --wait --wait-timeout 180

HINDSIGHT_SMOKE_AUTHORIZED=1 \
HINDSIGHT_SMOKE_ENDPOINT=http://127.0.0.1:8890 \
corepack pnpm test:hindsight-protocol

HINDSIGHT_SMOKE_AUTHORIZED=1 \
HINDSIGHT_SMOKE_ENDPOINT=http://127.0.0.1:8890 \
corepack pnpm test:hindsight-live
```

`test:hindsight-live` 创建独立临时 Git/SQLite 中文合成项目，通过实际 `HindsightService` 验证模型标签、版本变化、当前原文回读和提交后撤销清理，保留夹具证据。它不打开 Electron 的全局网络闸门，不扫描或上传真实项目。

4. 检查全部测试操作已经结算并清理后，执行 `GATEWAY_STATE_DIR=<同一账本目录> python3 deploy/hindsight/budget_gateway.py --close`，停止并移除测试网关容器，执行 `corepack pnpm hindsight:up` 恢复不计费待机。账本继续保留；后续实验需要新的明确授权和独立账本。

无计费网关边界测试：`python3 -m unittest discover -s deploy/hindsight -p 'test_budget_gateway.py'`。它只使用本机 HTTP 测试桩。网关依赖 Linux/macOS 文件锁；部署时在 Linux 容器中运行，不向桌面应用新增 Python 依赖。

### Todo 全阶段验证

`scripts/hindsight-todo-fixture.ts` 从固定的原 Todo 提交生成独立 Git 工程，增加六份合成规范与模型；30 道评测题和验收期待不放入知识目录。`corepack pnpm test:hindsight-fullchain` 在显式授权环境下运行真实 Electron IPC、Hindsight 和开发模型，保存来源回执及编码精确差异。其模型流量通过本次测试传输适配进入同一人民币预算网关，产品的团队策略与模型预算仍执行。

脚本在编码写入前导出 `preview.diff` 和 `pending-approval.json`；审阅后将该差异的完整摘要写入 `approved-digest.txt` 才继续。它不发布远端 PR，因此不会伪造完成验收节点。真实验收 IPC 的前置条件与受控运行时六阶段测试分别记录。

提案被复核拒绝时，`hindsight-fullchain-correction.mts` 可在同一隔离 Electron 中通过正式 IPC 拒绝旧提案、提交评审反馈并停在新差异前；`hindsight-fullchain-correction-finish.mts` 只接受新差异的准确审阅摘要。独立浏览器脚本 `hindsight-todo-browser-check.mts` 对已经完成的托管工作树运行真实 Chromium，保存十六项行为检查、截图及源码摘要。若仅该测试辅助脚本失败，保留原报告，在新目录修正后重跑；不把既有业务失败改写成成功。

已经完成编码、正式测试和浏览器检查后，`hindsight-fullchain-pr-finish.mts` 可核对这些证据并只续接 PR 包装、一次 PR 知识评审及提前验收拦截，结果另存 `final-report.json`。该报告的通过范围是接入和边界检查，PR 模型的业务警告需独立保留；外部浏览器报告不会自动变成产品内的评审工件。本轮实际结果与限制见[完整验证记录](../validation/hindsight-fullchain-validation-20261020.md)。

Electron 关闭后可运行 `scripts/hindsight-todo-live-evaluation.mts`，复用本轮隔离数据和银行，对本地词法与混合检索分别评测 24 道基线、3 道更新、3 道范围边界题。它最终恢复夹具原文、停用配置并核查远端清理。原调查流程与回答质量若未测，明确标记未测，不从检索分数推断。

若只需清理已结束的全阶段运行，在关闭该轮 Electron 后，使用该轮 `report.json` 和其隔离数据库 Hindsight 配置中的精确 `knowledgeBank`：

```bash
DEVFLOW_FULLCHAIN_ELECTRON_CLOSED=1 \
DEVFLOW_FULLCHAIN_REPORT="/absolute/path/to/this-run/report.json" \
DEVFLOW_HINDSIGHT_CLEANUP_BANK="df-k-<this-run-exact-bank-id>" \
HINDSIGHT_SMOKE_ENDPOINT="http://127.0.0.1:8890" \
node --import tsx scripts/hindsight-fullchain-cleanup.mts
```

清理工具只接受固定 Todo 来源提交产生的隔离临时 profile，并核对单一项目、银行和端点。它先禁用配置，再读取现有 operation 状态、删除对应文档；不检索、不重新抽取、不修改知识文件或费用账本。结果写入同目录的 `cleanup-report.json`，保留 profile 供诊断。确认 `status: "verified"`、知识字节未变、远端文档/节点/关系/实体及待处理操作全部为零后，才按上文关闭本次费用账本、停止测试网关；清理未完成时保留证据继续处理，不把停止容器当成清理完成。

## 实现与后续边界

- 已接入：持久任务及重启恢复、三次提交上限、取消选择/删除/到期/配对清理、精确来源回读、讨论搜索、全阶段宿主知识上下文、编码恢复当前性、本地回退、正式记忆影子候选。项目记忆（讨论、编码、已批准产物自动写入独立 bank）见[项目记忆](project-memory.md)。
- 正式记忆来源变化与任务同次保存；文件变化与数据库无法原子提交，发送、结算及每次引用都会重新核验。
- 模型升级采用停用旧配置后重建；未实现并行双 bank 验收后无缝切换。
- 未实现：ExperienceRecord、Reflect、自动确认业务关系、团队共享、博客发布、模型提取质量仪表盘及金额硬预算。这些不应通过打开一个开关宣称已完成。
- 实际验证结果见[首期开发记录](../validation/hindsight-integration-20261020.md)和[全链路验证记录](../validation/hindsight-fullchain-validation-20261020.md)。30 题小语料检索未证明混合模式优于词法，接线完成不等于检索价值已经达标。

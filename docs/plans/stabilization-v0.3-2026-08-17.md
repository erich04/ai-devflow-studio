<a id="ai-devflow-studio-stabilization-plan-v03"></a>

# AI DevFlow Studio 稳定性计划 V0.3

日期：2026-08-17。生命周期：完成；验收实现候选为 `1cb0482a9afe157c4e1dcdd7ae4e8026939f2b9d`。

范围：安全边界修复、权威源码收敛、租户隔离和渐进拆分 LocalStore。本计划与历史产品里程碑 v0.3 不同。以下为该稳定性批次的历史计划与结论。

<a id="objective"></a>

## 目标

解决当时开发线已确认的安全问题，将仓库收敛为一个权威源码树，独立审计组织/项目授权，并渐进降低 1.6 万行 LocalStore 的风险。每个切片必须可独立回退、由测试驱动，留下可通过完整 0.x、1.x 及有限 2.x 门禁矩阵的干净候选。

<a id="non-negotiable-boundaries"></a>

## 不可破坏的边界

- `CodingDiffArtifact.redacted` 保留历史上“发生过替换”的含义。
- `sanitizerVersion`、`sanitizedAt`、`secretReplacementCount` 记录处理来源。
- 证据脱敏与出站发布扫描是两个独立安全边界。
- 签发仓库凭据前扫描精确 Git 对象和 PR 标题/正文。
- 发布阻断不能绕过；须干净重建受管工作树，并对替代 commit 执行新的精确扫描。
- 桌面 bearer 权限限定项目，不能签发或复制 bearer 凭据。
- 配对码在串行化数据库事务下单次使用，失败次数有上限。
- 已有迁移不可变，归一化源码通过机器哈希锁定。
- 全部 schema 迁移提交后才开始隐私维护。
- SQLite 持久化只有一个文件出口：临时文件后原子重命名。
- 规范源码树和旧 Workspace Truth 投影不能同时自称权威。

<a id="execution-slices"></a>

## 执行切片

<a id="a-diff-provenance-and-outbound-publication-safety"></a>

### A. 差异来源与出站发布安全

1. 脱敏编码 diff 的新增、删除及上下文所有行。
2. 保存明确脱敏来源，不重定义 `redacted`。
3. 打开时的隐私维护覆盖旧编码差异记录。
4. 签发凭据前扫描精确 commit 范围和出站 PR 文本。
5. 保存扫描结果，未知、不完整或检出敏感内容时阻断。
6. 为 `content_scan_blocked` 提供确定性干净重建恢复路径。

验收：删除行及 PR 文本中的测试秘密被拦截，安全 diff 带受支持来源；安全扫描提交前不产生服务商调用、凭据、推送或草稿 PR 副作用。

<a id="b-authoritative-source-convergence"></a>

### B. 权威源码收敛

1. 安全切片审阅期间冻结 main 移动。
2. 保留代码工作树之外的无关用户文档变更。
3. 将完整测试后的开发线快进/合并到规范 main。
4. 停用临时关联工作树，只清理已证明可清理的条目。
5. 在注册/投影来源处归档旧 Workspace Truth 源码，不只修改会重新生成的托管块。

验收：仅一个活跃权威源码树，无遗漏的未合并分支内容、无用户变更丢失，旧树不能重新生成活跃旗舰声明。

<a id="c-tenant-and-request-boundary-audit"></a>

### C. 租户与请求边界审计

审计 Seed/Postgres 的组织与项目条件一致性、桌面 bearer 作用域、共享/API 请求解析一致性、配对重放/限制及未认证请求体上限。实际角色只有 `owner`、`lead`、`member`；不包含 `viewer` 是明确产品决定，不为审计编造角色。

验收：跨项目读写默认拒绝；bearer 调用者不能创建凭据；并发配对交换恰好一个成功；未知配对码永不成功；超大 JSON 在无界缓冲前被拒；Seed/Postgres 行为一致。

<a id="d-progressive-localstore-decomposition"></a>

### D. 渐进拆分 LocalStore

1. 提取 schema/迁移职责，用源码摘要锁定版本 1 至当时当前版本。
2. 提取单一原子持久化出口。
3. 增加索引化隐私来源，避免每次打开都加载当前记录。
4. 将隐私维护及工作流/证据持久化提取为边界明确的领域模块。
5. 全程保留特征测试，同一切片不重写能力或状态机领域。

验收：新库和已有数据库均达到桌面 schema 32；迁移失败回滚；迁移后才维护隐私；当前记录使用部分索引；重开幂等；文件持久化仍只有 `write temp → rename`。

<a id="required-final-gates"></a>

## 最终必需门禁

- 工作区类型、单元/组件、跨平台和生产构建。
- V1.5 确定性 GitHub 交付及打包桌面冒烟。
- V2.0 运行时、V2.1 检索/记忆、V2.2 多 Agent 评估器与状态门禁。
- 真实临时 PostgreSQL 16，团队 schema 19。
- Docker 栈及迁移/回滚生命周期冒烟。
- 可复现桌面产物检查和冷启动副作用检查。
- 新的标准安全扫描，无未解决 P0/P1。
- 干净候选提交和仓库内结果记录，包含精确命令、结果、schema、产物摘要与清理状态。

<a id="explicitly-deferred"></a>

## 明确延后

- 一次性重写 LocalStore 剩余能力/状态机代码。
- 通过外部词典网络访问恢复拼写检查。
- 未经产品与授权决策新增 `viewer`。
- 用付费服务商或生产 GitHub 写入替代确定性发布门禁。
- 复用历史 v0.3 的发布证据命名空间。

<a id="acceptance-record"></a>

## 验收记录

仓库内记录见 [result.md](../releases/stabilization-v0.3-2026-08-17/result.md)，将实现候选绑定到完整测试矩阵、可复现桌面产物、临时基础设施门禁及已封存标准安全扫描。

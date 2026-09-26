<a id="module-6-一枚可信-draft-pr-的诞生"></a>
# 模块 6：一枚可信 Draft PR 的诞生

<a id="teaching-arc"></a>
## 教学主线
- **比喻：** 防拆封快递。代码、diff、测试和 PR 文案各有指纹；收件人先批准准确包裹，快递员只拿一次性钥匙，送达后还要核对回执，任何封条变化都退回人工恢复。
- **开场切入：** “已经写完代码”离 GitHub 上出现一个可信 Draft PR 还有很远：系统必须证明正在发布的就是刚才测试和批准的那一份。
- **核心认识：** GitHub Delivery 用 commit 与多种 digest 把本地工作区、差异、测试、PR package、Web approval、短时凭据和最终 Draft PR 绑定为同一条不可偷换的证据链。
- **与读者的关系：** 你能识别安全交付真正需要的条件，也知道遇到 stale intent / authority mismatch 时为什么应显式 Resume，而不是自动重试危险写操作。

<a id="code-snippets-pre-extracted"></a>
## 代码片段（预先摘录）

文件：`packages/shared/src/github-delivery.ts`（摘录时第 144–160 行）
```ts
  repository: string
  baseBranch: string
  headBranch: string
  baseCommitSha: string
  expectedCommitSha: string
  diffArtifactId: string
  diffSourceDigest: string
  testEvidenceId: string
  testEvidenceCreatedAt: string
  testEvidenceDigest: string
  prPackageArtifactId: string
  prPackageUpdatedAt: string
  prPackageDigest: string
  changedPaths: string[]
  intentDigest: string
  idempotencyKey: string
  status: GitHubDeliveryStatus
```

文件：`apps/desktop/electron/github-delivery-processor.ts`（摘录时第 903–910 行）
```ts
    async (credential) => {
      if (
        credential.repositoryId !== source.repositoryId ||
        credential.repository !== source.repository ||
        credential.headBranch !== source.headBranch ||
        credential.expectedCommitSha !== source.expectedCommitSha
      ) {
        throw new Error('Credential authority mismatch')
```

文件：`packages/shared/src/github-delivery.ts`（摘录时第 299–307 行）
```ts
  if (
    repository !== input.intent.repository ||
    baseBranch !== input.intent.baseBranch ||
    headBranch !== input.intent.headBranch ||
    headSha !== input.intent.expectedCommitSha ||
    input.draft !== true
  ) {
    throw new Error('GitHub Delivery completion does not match the approved intent')
  }
```

<a id="interactive-elements"></a>
## 交互元素
- [x] **代码与白话对照：** 原样使用处理器第 903–910 行。解释只有仓库 ID、仓库名称、交付分支和预期提交都与已批准的交付意图匹配，凭据才会被接受。
- [x] **测验：** 三个最终应用题：（1）测试通过后、发布前工作区提交发生变化；（2）服务方返回普通 PR，而不是草稿 PR；（3）出站秘密扫描无法完成。正确处理依次为恢复、拒绝、恢复，不能选择“仍然发布”。
- [ ] **群聊动画**
- [ ] **数据流动画**——模块 3 已满足此项；这里使用静态流程，避免重复相同交互。
- [ ] **拖放练习**
- [x] **其他：** 首屏流程图：受管工作树 → 重新测试 → 封存交付意图 → Web 明确审批 → 出站扫描 → 短时凭据 → 发布分支 → 创建并验证 Draft PR → 验收。生命周期图支持点击查看 `approval_required`、`approved`、`publishing_branch`、`branch_published`、`creating_pr`、`completed`、`recovery_required`；结尾提供整体架构卡片。

<a id="required-screens"></a>
## 必需页面
1. 防拆封快递比喻和完整交付链。
2. 按真实交付意图字段展示摘要指纹与封条卡片：提交、差异、测试、PR 交付包、交付意图。
3. 原样展示凭据权限检查代码与白话对照。
4. 可点击交付生命周期，以及明确的恢复分支。
5. 完成校验（`draft === true` 且 head SHA 精确匹配），以及完整系统架构：UI → Electron Main → Shared 契约 → SQLite/Outbox → API/Postgres/Web → GitHub。
6. 课程结尾的三个情景测验，并简要说明如何指导开发和排查这个项目。

<a id="reference-files-to-read"></a>
## 必读参考文件
- `references/interactive-elements.md` → 代码与白话对照块（Code ↔ English Translation Blocks）、单选测验、交互式架构图、模式/功能卡片、流程图、编号步骤卡片、术语提示。
- `references/design-system.md` → 配色、字体、间距与布局、模块结构、响应式断点。
- `references/content-philosophy.md` → 全文。
- `references/gotchas.md` → 全文。

<a id="connections"></a>
## 模块衔接
- **上一模块：** 为什么 Gate 不肯放行——明确了状态变更需要精确、当前且作用域匹配的证据。
- **下一模块：** 无。结尾回到整体架构与实际排障时可使用的表达方式。
- **语气与样式：** 使用中文，像懂技术的朋友一样讲解，采用青绿色强调色。本模块使用 `var(--color-bg)`。受管工作树、提交 SHA、差异、摘要指纹、幂等键、交付意图、权限依据、短时凭据、出站扫描、Draft PR、过期意图、恢复首次出现时提供术语提示。明确说明受管工作树提供隔离，但不是安全沙箱。不添加自定义样式或脚本。

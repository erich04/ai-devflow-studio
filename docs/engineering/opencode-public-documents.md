# OpenCode 编码中的公开文档读取

`devflow_document` 是 #237 的结构化公开文档读取工具，仅在使用已保存 Provider 和治理代理的受管 OpenCode 编码父/子会话内注册。它沿用私有插件、运行归属、串行工具、取消和总工具次数限制。工作台会话、只读阶段、内置仓库审查、环境变量兼容入口均不因此获得网络工具；`webfetch`、`websearch` 和 shell 网络命令继续拒绝。

## 目标和传输边界

输入只有一个 `url`，最长 2,048 字符。不接受方法、请求头、请求体或自定义代理。只允许 HTTPS 和默认端口，拒绝凭据、查询字符串、路径分隔符/空字符/二次百分号编码。片段不会发送到服务器。

当前受控目标：

| 主机 | 文档路径 |
| --- | --- |
| nodejs.org | `/api`、`/docs` |
| developer.mozilla.org | `/en-US/docs`、`/zh-CN/docs` |
| typescriptlang.org、www.typescriptlang.org | `/docs` |
| react.dev | `/learn`、`/reference` |
| vite.dev | `/guide`、`/config` |
| vitest.dev | `/guide`、`/api`、`/config` |
| playwright.dev | `/docs` |
| www.electronjs.org | `/docs` |
| docs.python.org | `/3` |
| pnpm.io | `/cli`、`/settings`、`/workspaces`、`/package_json`、`/npmrc` |

每次请求和重定向都重新核验主机、路径及 DNS 的**所有**返回地址；任一地址为私网、回环、链路本地、组播、benchmark、文档或保留地址时不使用该组结果。IPv6 只接受排除特殊用途范围后的全球单播地址。HTTPS 连接固定使用当次已验证的地址，同时保留原始主机的 SNI 和显式 TLS 证书校验；不在连接时重新解析 DNS，不使用用户配置的网络代理或连接池。

系统 DNS 最多等待 3 秒；解析失败或结果包含非公网地址时，使用受限公共 DNS 备用查询。只向固定的 `cloudflare-dns.com`（连接 IP 固定为 `1.1.1.1`、TLS 证书必须有效）发送已通过白名单检查的官方主机名，不发送文档路径、查询参数、模型密钥或其他用户数据。该 GET 查询只请求 A 记录，最多 5 秒，响应最多 16 KiB，禁止重定向和压缩；要求 DNS Question 与请求主机/类型一致，只接受同名 A 记录，再逐一通过公网地址校验。CNAME、额外主机及失败/截断/不匹配的响应均拒绝。不会改系统 DNS，也不会放行 fake IP。结果的 `dnsResolution` 为 `system` 或 `trusted-public-dns`，后者表示本次查询至少一跳使用了备用解析。

最多跟随 3 次重定向。整个查询包括 DNS、重定向和正文读取最多 15 秒。仅接受 HTTP 200 的 UTF-8 文本/Markdown/HTML；请求 `identity`，拒绝压缩响应，头部声明和流式读取均限制在 512 KiB。HTML 去除标签、脚本、样式等后返回纯文本，最多 32,000 字符；截断必须在结果中明确标注。

结果包含源 URL、最终 URL、重定向次数、内容类型、接收字节数和 `trust: untrusted-public-reference`。它是参考资料，不能批准命令、改变执行权限或覆盖用户需求。返回结果前再次核验会话和停止状态，取消后的迟到结果不得继续执行。

有些本机代理会将公开域名解析为 `198.18.0.0/15` 的 fake IP；这属于禁止的 benchmark 范围。备用解析必须取得独立核验的公网结果，否则查询失败；不能以放宽地址校验代替正确的公网连接。

## 与上游的接点

契约核对版本为 OpenCode 1.18.15。使用其 `@opencode-ai/plugin` 的 `tool`、`tool.schema`、`context.ask` 和 `context.abort`，保留现有调度；未替换原生任务执行器。SDK 从 OpenCode 私有配置目录解析，插件由 DevFlow 写入该目录，不能从用户仓库加载依赖或插件。

内部费用归属接口独立于文档正文：

- `OpencodeHttpCodingEngineConfig.onSessionCreated({ codingRunId, workspaceId, sessionId })` 在父会话/metadata/工作区校验后、首个模型请求前调用。回调抛错即停止，不发送请求。
- 私有插件的 `chat.headers` 写入 `x-devflow-coding-run`、`x-devflow-workspace`、`x-devflow-root-session` 和 `x-devflow-session`。值仅来自已核对的父子会话 metadata；旧值和大小写别名被移除。停止或越界会话不能生成这些头。
- 主进程据此将真实模型请求归入可信 Coding Run。头只在本机治理代理使用，不进入公开文档请求。

## 检查

```sh
corepack pnpm exec vitest run apps/desktop/electron/public-document-reader.test.ts apps/desktop/electron/opencode-task-guard.test.ts apps/desktop/electron/opencode-http-engine.test.ts
corepack pnpm exec tsc --project tsconfig.opencode-smoke.json --noEmit
corepack pnpm exec tsx scripts/opencode-document-contract.mts
```

最后一条使用真实 OpenCode、临时项目/独立 profile、合成模型和一页真实 Node.js 文档，不使用服务商密钥。它检查自定义工具执行、禁止目标、内部归属头、只读进程无文档工具及源仓库未改变。它不代替真实模型的端到端验收。

单元测试独立覆盖系统/公共 DNS 的私网结果、问题不匹配、大小超限、重定向和取消。实际验证结果以本次输出和 B 工作包验收记录为准。

2026-10-23，本机 Node.js 24.18.0 / OpenCode 1.18.15 的 `opencode-document-contract.mts --debug` 通过。实际文档请求接收 482,438 字节、返回 32,000 字符（`truncated: true`），使用 `trusted-public-dns`；工具注册/执行、私网拒绝、4 个内部归属头、只读隔离和源仓库未修改均通过。此次模型为本地合成回复、无服务商费用；真实模型的完整编码验收另行记录。此前独立 profile 的 SDK 首次初始化曾触发现有 60 秒就绪超时，成功运行未延长默认窗口，仍需在实际机器上分别观察启动状态。

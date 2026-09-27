<a id="opencode-coding-adapter-spike"></a>

# OpenCode 编码适配器技术试验

<a id="summary"></a>

## 摘要

决定：v0.6 托管编码传输使用 `opencode serve` HTTP 端点。

ACP 可作为未来 IDE 集成参考，但首版不直接使用。`opencode acp` 增加 stdin/stdout Agent Client Protocol 连接，取消仍转交同一底层会话中止能力；Electron 主进程直接使用 HTTP 所需组件更少。以下为当时试验记录。

<a id="environment"></a>

## 环境

- OpenCode 版本：1.14.40。
- 仓库：操作系统临时目录中的本地测试样例。
- 免费工具流验证：内置模拟服务商。
- 对已配置真实服务商仅做有限探测，确认凭据/服务商错误可能发生，不应驱动默认验证。

<a id="http-findings"></a>

## HTTP 发现

使用 `opencode serve --hostname 127.0.0.1 --port 4097` 验证：

- `POST /session` 创建会话，按权限设置 ask。
- `POST /session/{sessionID}/message` 发送任务。
- `GET /permission` 读取待授权请求。
- `POST /permission/{requestID}/reply` 批准或拒绝。
- `GET /session/{sessionID}/diff` 编辑后返回仓库相对差异。
- `POST /session/{sessionID}/abort` 中止执行。

成功路径：DevFlow 风格脚本创建临时仓库会话，Agent 请求两个文件编辑权限及测试命令的 bash 权限；脚本逐一批准，OpenCode 修改、运行测试，diff 端点返回补丁。

失败/约束路径：不回答权限时请求保持 pending，可调用回复端点默认拒绝；批准用于中止测试的 bash `sleep 30` 后，通过 abort 取消，返回 MessageAbortedError 并清除待授权请求。

<a id="acp-findings"></a>

## ACP 发现

使用 `opencode acp --hostname 127.0.0.1 --port 4098 --cwd <fixture>` 验证：它启动普通 HTTP 后端服务，控制平面为 stdin/stdout NDJSON Agent Client Protocol；权限转交要求客户端实现 requestPermission，取消委托底层会话中止。

结论：ACP 可作未来编辑器兼容层，但不是 v0.6 Electron 托管运行时的最简首选。

<a id="go--no-go"></a>

## 采用与不采用

采用 HTTP 服务传输；首版不直接实现 ACP。

<a id="product-constraints-confirmed"></a>

## 已确认产品约束

- 不使用 --dangerously-skip-permissions。
- edit/bash/write/patch 默认 ask。
- 权限超时视为 DevFlow 拒绝。
- 取消调用会话 abort 并记录编码中断。
- 通过 diff 端点捕获差异，保存/同步前脱敏并限制大小。
- 不同步提示词、原始轨迹/补丁、cwd、stdout、stderr 或服务商秘密。

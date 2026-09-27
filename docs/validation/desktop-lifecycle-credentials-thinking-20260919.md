<a id="desktop-lifecycle-credentials-and-thinking-configuration--2026-09-19"></a>

# 桌面生命周期、凭据与思考配置 — 2026-09-19

<a id="125-native-quit"></a>

## #125 原生退出

旧 Electron 41.10.5 候选安装包在连接及未连接调试器时均复现失败。同一毫秒内发生两次 `before-quit` 回调，随后出现 `window-all-closed`，但始终没有 `will-quit`。目标进程保持存活，需要 SIGTERM 终止。这独立证明应用回调重入问题，与 #135 的钥匙串症状不同。

清理后，通过 `setImmediate` 调度第二次 `app.quit()`，让最初原生退出回调先结束。同一 41.10.5 包只修改这一行后，原生菜单退出在 291ms 内正常终止。随后重建的 42.11.6 包使用同一隔离档案，通过两次冷启动及原生菜单退出，退出码为 0，没有发送终止信号。最终观察器记录的是包含操作者等待时间的进程存活时长，**不是**退出延迟。原生菜单操作通过 CUA 完成。

本地证据：`out/issue-resolution-20260919/plain-quit-baseline.json`、`plain-quit-probe-result.json`、`quit-probe-result.json` 和 `out/desktop-menu-quit-smoke/report.json`。观察器为 `scripts/desktop-menu-quit-smoke.mjs`，等待操作者执行原生退出。

<a id="135-system-credential-waits"></a>

## #135 等待系统凭据

Electron 从 41.10.5 升级到 42.11.6，并使用异步 safeStorage API。等待系统钥匙串时应用保持响应，显示操作/类别、已等待时间、安全结果和诊断编号。取消/超时会拒绝调用方并丢弃迟到的原生结果，不声称能关闭 macOS 自身授权弹窗。错误不包含原生异常原文或凭据。团队与服务商路径均等待解密，并在等待后重新检查可能变化的配对/服务商身份。

官方 API 参考：[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。42.4.1 包含异步初始化修复，本次选用 42.11.6 补丁版本。

用户手动允许系统授权后，隔离 macOS 真实检查通过：

- 原生异步加密/解密往返成功。
- 41.10.5 生成的模拟密文在 42.11.6 下正确解密（`shouldReEncrypt: false`），未读取真实服务商密钥。
- 在系统接口适配层注入受控延迟后，页面导航仍响应；取消使后续完成结果不能保存服务商。
- 受控拒绝结果正确脱敏，随后真实原生加密保存成功，界面恢复。历史记录包含成功、失败和取消。

证据：`out/desktop-credential-smoke/report.json` 及两张截图。`scripts/desktop-credential-smoke.mjs` 区分真实原生加密检查与注入的延迟/拒绝场景。单元测试另覆盖超时/存储不可用、重试和等待期间身份变化。

仍待验收：正常 Developer ID 签名安装。本机没有有效签名身份；已向用户询问既有签名包或 CI 环境。不能把未签名测试副本的成功当作签名分发验证，#135 为此继续保持 open。

<a id="146-provider-thinking-controls"></a>

## #146 服务商思考控制

服务商元数据保存可选思考设置。旧版受支持的官方 DeepSeek 配置解析为 enabled/low。无需读取、解密或重新提交密钥即可修改设置；持久化比较并交换会拒绝过期编辑。既有密文和历史记录不变。

已识别的官方 DeepSeek 模型提供 enabled/disabled 和 low/high/max。其他端点/模型采用服务商默认值，拒绝不支持的显式设置。所有内置调用继承同一配置：会话、澄清、设计、知识审查和原生编码。推理展示回调不能覆盖模型设置。OpenCode 仍独立管理。新请求采用已保存配置，进行中请求保留其启动时捕获的配置；会话历史、阶段/审查轨迹及原生服务商调用轨迹保留实际生效设置。展开推理块只改变展示状态。

2026-09-19 核对的官方参考：[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)、[Chat Completions 参数](https://api-docs.deepseek.com/api/create-chat-completion/)。测试检查实际发出的请求正文，不消耗用户模型额度。验证及建议处理如下：

- Cursor 审查 `2d4f825c-9e52-428e-a581-3775c8db50c4` 发现真实 IPC 允许列表缺陷：思考设置更新复用删除解析器，导致思考字段被拒绝。回归复现后用专用更新解析器修复；99 项 IPC/配置/存储测试通过，包括经解析器和存储检查密文不变及拒绝旧版本。
- 凭据写入现拒绝相互重叠的保存/配对，不再把旧意图排在系统授权等待之后。取消/重试及 OpenCode 解密期间身份变化测试通过。
- 使用 CUA 操作独立桌面安装包档案：明确保存 enabled/low，改为 enabled/high 并保存，然后通过原生菜单退出。重开 SQLite 确认设置已保存、模拟密文不变。该设置测试不需要访问钥匙串或调用付费服务商。证据：`out/issue-resolution-20260919/batch2-ui-result.json`。
- 设置表单在编辑时清除之前的成功提示，并说明所选值保存后才生效。
- 初次定向回归发现三个期望值需按新的受控消息/元数据调整，另有一个文本匹配含糊。修正后 App、设置、诊断和配对共 174 项通过；最终设置/配对边界 17 项通过。
- 工作区全部五个类型检查命令通过，包括 Web 生产构建。桌面渲染层/主进程/preload 及未签名包构建通过，不替代上文待完成的签名安装证据。

2026-09-20 最终仓库回归执行 4,002 项测试：3,940 项通过，62 项失败集中在三个文件。这些文件仍未向更严格的编码简报提供已批准澄清产物、在已测得失败输出用量后仍期待未知费用，或期待旧英文错误。更新其测试数据/期望值，未削弱生产校验；三个文件共 86 项随后全部通过。日志：`out/issue-resolution-20260919/batch2-full-suite.log` 和 `out/issue-resolution-20260919/full-suite-regressions-fixed.log`。

完整根目录 `pnpm typecheck`（包括两项冒烟脚本类型检查）和 `pnpm test:cross-platform` 也通过。这些是当时的本地结果；Windows CI 与签名安装验证仍需独立证据。

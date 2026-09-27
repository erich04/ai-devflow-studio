<a id="pairing-recovery-and-safe-diagnostics--issue-130"></a>

# 配对恢复与安全诊断 — Issue #130

<a id="behavior"></a>

## 行为

桌面配对交换保留受控原因，区分已过期与无效/已使用/已撤销的配对码。普通 401 仍按认证失败处理。用户看到中文解释和恢复方向，不暴露 IPC 或任意服务端文本。Web 在过期后隐藏配对码并禁用复制，仍允许重新生成；发放/撤销进行中拒绝重复点击。账户、角色或项目变化后忽略迟到结果。

桌面“诊断”页支持筛选、复制/导出本地操作历史。Web 配对区域显示当前账户/项目近期诊断元数据。API 和桌面维护有上限、仅所有者可读的 JSON 历史，最多 1,000 次操作；桌面还包含凭据访问终态。只持久化固定元数据字段，排除令牌、配对码、Cookie、API 密钥、路径和完整请求/响应正文。未认证的 API 配对记录刻意不伪造用户或项目归属。

每个请求携带 `x-devflow-diagnostic-id`。Web 代理、桌面和 API 在响应头中保留该 UUID，既有响应正文结构精确不变。未知 API 异常与 JSON 正文解析错误使用受控错误码记录；传输失败仍有本地 ID。无效响应 JSON 与 HTTP 成功在同一 ID 下分别记录。配对 POST 不自动重试；失败后由用户生成新码。

<a id="operator-query"></a>

## 操作者查询

API 日志默认位于进程工作目录下的 `data/api-diagnostics.json`。`DEVFLOW_API_DIAGNOSTICS_PATH` 可指定操作者管理的位置。日志不经未认证 API 暴露，操作者访问由系统文件权限控制。桌面历史位于所选数据档案的 `diagnostics.json`，与业务数据库分开。

    corepack pnpm exec tsx scripts/query-diagnostics.ts --file <log-path> --id <UUID>
    corepack pnpm exec tsx scripts/query-diagnostics.ts --file <log-path> --reason pairing_code_expired --export <new-file.json>

其他筛选参数为 `--from` / `--to`（ISO 时间戳）、`--operation`，以及存在相应上下文时的 `--project` 和 `--run`。导出拒绝覆盖已有文件，以 0600 权限写入。Web 历史仅限当前已挂载会话，不增加新的服务端查询权限。共享会话记忆与业务审计不变。

<a id="evidence"></a>

## 证据

`scripts/pairing-diagnostics-integration.test.ts` 基于真实仓储和路由实现启动隔离 HTTP 监听器，连接实际桌面 HTTP 客户端。受控时钟使有效码过期；测试观察过期错误和已持久化、匹配的 API/桌面 UUID，生成新码后成功交换，再拒绝重复使用。重开日志包含全部结果，但不含任一配对码或已签发令牌。这不是生产账户或真实服务商测试。

代表性测试覆盖普通 401、无效码、403、网络失败、503、格式错误响应 JSON、未知异常、有界/停滞错误正文、并发日志写入和持久化、界面复制/导出投影、Web 过期、重复点击，以及账户/项目/角色变化。配对与团队数据错误保留当前所选项目及需求状态。

Cursor 建议审查 `ffb5f9fd-720d-4dfe-b563-ffeaed341cf5` 因重复连接失败结束，没有最终审查，不计为通过。独立代码审查另修复了被动副作用执行前的账户范围可见性，以及身份变化后迟到的撤销/复制结果跨越身份边界的问题。

PR #149 CI 发现打包交付撤销证明的协议回归：在所有错误正文加入 diagnosticId，违反了原本刻意采用的精确键校验。真实远端客户端与 API 诊断组合复现失败；修正后只在响应头关联诊断，保留原正文，不削弱凭据证明校验。HTTP 配对恢复场景在该兼容表示下仍通过。

同次 CI 已完成 Docker 生命周期验证，随后 setup-node 自动保存宿主缓存失败，因为全部依赖安装在 Docker 内。该作业现按[官方 setup-node v5 参数](https://github.com/actions/setup-node/blob/v5/action.yml)显式禁用包管理器自动缓存。

<a id="pr-149-ci-follow-up"></a>

# PR #149 CI 后续记录

首次 CI 暴露两处过期端到端测试数据：配对视觉样例已于 9 月 10 日过期，团队页滚动检查仍选择旧同步按钮名称。样例现生成相对十分钟有效的模拟配对码，滚动测试使用当前用户可见标签。过期行为及视口/滚动断言不变。远端 CI 将重跑；首次失败不计为通过。

第二次运行中，macOS 全部 4,003 项单元测试与 41 个浏览器场景通过，Windows、Postgres、Docker 及 Docker 生命周期也通过。之后的 Electron 冒烟测试仍选择旧团队同步标签并期待旧成功文案；两处选择器改为 App 测试已检查的当前界面措辞。本记录写入时，原生冒烟仍须在后续 CI 通过，才能宣称该批已完整验证。

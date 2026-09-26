<a id="desktop-pairing-security-contract"></a>

# 桌面配对安全契约

本文定义将 Electron 绑定到团队项目时当前采用的权限契约。

- 已认证且处于有效状态的项目成员均可创建配对码，但只能为自己的身份创建。Web 界面在创建前显示成员、项目及配对后获得的桌面角色。
- `createdByUserId` 是不可变的令牌主体。交换接口只接受 `code`，拒绝客户端提供的用户 ID 或角色。
- 签发时记录 `issuedRole`。组织所有者在桌面端的权限有意限制为 `lead`。每次请求取 `issuedRole` 与成员当前项目角色中的较低权限，因此后续角色变化可以降低已有令牌的权限或使其失效，但不能提升其权限。
- schema v23 之前只有负责人能配对，因此旧配对记录和令牌迁移时，签发角色上限设为 `lead`。
- 配对码十分钟后过期，最多允许五次失败尝试，只能使用一次，创建者也可以明确撤销。桌面令牌三十天后过期，用户可以主动撤销自己的令牌。
- 配对码和 Bearer 值都是只能复制一次的机密。Postgres 只保存哈希；API 错误与审计数据不得包含原值。
- 成员被移出项目后，相关请求默认拒绝。`member` 角色的桌面会话不能使用仅限 `lead` 的门禁审批、策略例外、预算或交付权限。

相关 API 边界：

- `POST /api/team/projects/:projectId/pairing-codes`
- `DELETE /api/team/projects/:projectId/pairing-codes/:pairingCodeId`
- `POST /api/desktop/pairing/exchange`
- `DELETE /api/team/projects/:projectId/desktop-tokens/:tokenId`

签发和撤销配对码需要已签名的浏览器 Cookie。开发身份请求头和已有的桌面 Bearer 令牌均不能签发替代凭据。

<a id="independent-organizations-on-one-devflow-deployment"></a>

# 在同一套 DevFlow 部署中使用独立组织

该功能需要显式启用，复用现有经过身份认证的自托管 Web/API/Postgres。权限模型见 [ADR 0023](../adr/0023-independent-organizations.md)，实际测试范围见[验证记录](../validation/multi-organization-20260921.md)。

<a id="upgrade-without-discarding-current-work"></a>

## 保留现有工作的升级步骤

1. 备份 Postgres 和每个桌面的完整数据目录，包括 SQLite 和凭据元数据。保留既有 API 会话/加密密钥和系统钥匙串身份。
2. 启动更新后的 API 前，按正常流程执行 `db:migrate`。schema 29 会补齐现有账户的成员关系，不会重置项目或 Run。就绪检查要求 schema 29。
3. 保持 `DEVFLOW_REQUIRE_AUTH=true`、演示/模拟运行时关闭及 `DEV_AUTH_ENABLED=false`。在 API 环境设置 `DEVFLOW_MULTI_ORGANIZATION_ENABLED=true` 并重启。使用 Compose 时，在 `.env` 中配置；既有一次性迁移和启动顺序不变。
4. 在 Web 打开**组织与成员**，创建组织后明确切换到该组织。新组织没有项目；切回原组织后，仍可看到原有项目。

默认仍采用单团队接入流程。将开关设回 false 会关闭新组织创建和未知 GitHub 账户注册，但不会删除其他组织，也不会阻止既有用户切换。这不是数据库降级。不要用旧二进制访问已升级数据库；回滚二进制需要升级前的数据库备份，并协调停止服务。重建或重启应用时应保留桌面数据。

<a id="members-and-desktop"></a>

## 成员和桌面配对

所有者根据受邀者自己组织页面显示的数字 **GitHub 账号 ID** 生成邀请。明确选择组织角色和项目访问范围，然后直接向本人分享一次性令牌。受邀者登录后，在**组织与成员**接受邀请，再切换组织。令牌 24 小时后过期，不能重复使用。受邀者必须在接入开关启用时注册；关闭接入后，接受邀请不能让未知账户获得登录资格。若邀请人已被撤销、停用或不再是所有者，需要由另一位所有者重新发出邀请。

Web 中切换组织只影响浏览器会话。桌面应单独配对到所选团队项目。一个桌面数据档案只保留一个活动配对；同时使用多个组织时，使用独立档案或设备。角色变化或组织归档会撤销旧桌面凭据。恢复后请生成新的配对码；原有本地项目和历史不会因此丢弃。

归档会保留项目和请求，页面显示恢复入口，替代团队工作台。所有者可在组织管理中恢复组织。至少必须保留一名活动所有者。页面列出近期组织、成员和邀请审计事件，历史记录中不包含凭据。

<a id="assign-github-app-repositories"></a>

## 分配 GitHub App 仓库

多个组织使用受控 GitHub 交付前，部署操作者必须分配每个仓库。组织所有者不能自行获得任意 GitHub App 访问权。展开 **组织标识（供部署配置使用）** 取得组织 ID，然后配置 API：

```dotenv
DEVFLOW_GITHUB_REPOSITORY_ASSIGNMENTS='[{"organizationId":"org-example","installationId":"123","repositoryId":"456"}]'
```

使用真实的数字安装 ID、仓库 ID 和精确组织 ID。每个仓库只能出现一次。修改列表后重启 API，组织所有者即可通过既有 Web 流程配置项目绑定。启用功能时，应纳入已经存在的绑定。

未分配的仓库仍会被阻断，即使账户是组织所有者、已有旧绑定，或者接入开关后来被关闭。移除分配会停止新的交付操作，但不会追溯撤销 GitHub 已签发的令牌；如需撤销，请使用既有绑定/令牌撤销流程。GitHub App 的选定仓库授权和短期凭据策略保持不变。

只要存在第二条组织记录，包括已归档团队或旧演示数据，就需要配置仓库分配。关闭开关不会取消这一边界。应为现有仓库配置分配，不得删除保留的团队数据来绕过检查。

<a id="repeatable-verification"></a>

## 可重复验证

```bash
corepack pnpm typecheck
corepack pnpm test
DEVFLOW_TENANCY_TEST_DATABASE_URL=postgresql://... corepack pnpm test:organization-postgres
```

使用专用测试数据库。组织测试套件创建随机 schema，将旧账户从 schema 28 迁移，使用真实 Postgres 和独立本地 SQLite 存储，最后只清理自己创建的 schema 与目录。该套件中的 GitHub 登录和 Agent 动作使用确定性测试适配器，不调用付费模型，也不发布到 GitHub。CI 在 Postgres 作业中运行它。独立浏览器验收和仍待补充的真实工作流证据见验证记录。

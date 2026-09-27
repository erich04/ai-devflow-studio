<a id="desktop-data-profiles"></a>

# 桌面数据配置

Electron 将每个 LocalStore 目录视为显式的数据配置（Profile）。一个配置拥有一个 `devflow.sqlite`，以及其中保存的本地项目、Run、配对、服务商、证据和工作流状态。程序不会通过比较工作流进度来合并、复制、删除或选择配置。

<a id="resolution-order"></a>

## 选择顺序

配置解析发生在 Electron 单实例锁之前，也在 LocalStore、恢复任务或团队同步启动之前：

1. 当前运行模式已有保存的配置时直接复用。显式设置的 `DEVFLOW_USER_DATA_DIR` 只有解析到相同目录才会被接受。
2. 尚无保存配置时，`DEVFLOW_USER_DATA_DIR` 表示操作者明确选择的目录。
3. 尚无保存选择时，复用唯一发现的已有数据库。
4. 未发现已有数据库时，开发环境使用稳定的 `AI DevFlow Studio/local-development` 配置，安装包使用 Electron 产品默认目录。

存在多个有效数据库、又没有显式或已保存选择时，启动会在打开任一数据库前停止。此时设置一次 `DEVFLOW_USER_DATA_DIR`，选择所需配置。已保存配置消失时，启动同样停止，不会静默打开其他数据库。

如果 `DEVFLOW_USER_DATA_DIR` 与已保存配置指向不同目录，程序会在 LocalStore、工作流 IPC、团队同步及恢复调度器启动前停止，也不会覆盖注册表。取消设置 `DEVFLOW_USER_DATA_DIR` 即可重新打开已保存配置。若确实需要一次隔离运行，必须同时设置 `DEVFLOW_USER_DATA_DIR` 和独立的 `DEVFLOW_DATA_PROFILE_REGISTRY_PATH`；只改变数据目录不代表切换配置。

成功选择记录在本地 `data-profiles.json` 注册表。冒烟测试将 `DEVFLOW_DATA_PROFILE_REGISTRY_PATH` 指向临时路径，因此不会替换操作者已保存的选择。

<a id="privacy-and-recovery-boundaries"></a>

## 隐私与恢复边界

- 可提供给渲染进程的诊断仅包含配置名称、来源、模式和不可逆路径指纹，不包含数据库绝对路径。
- 绝对路径和注册表仅保留在本机，不进入团队同步或服务商上下文。
- 切换配置不会修改任一 SQLite 文件。
- 恢复需要明确选择配置，不会自动合并数据库。
- 数据库损坏、注册表不受支持、已保存配置不可用，是分别处理的启动错误；遇到这些情况均拒绝继续启动。

当前注册表尚无保存配置时，首次显式选择：

```bash
DEVFLOW_USER_DATA_DIR="/absolute/local/profile" corepack pnpm dev:electron
```

配置已经保存后，如需一次性的隔离启动：

```bash
DEVFLOW_USER_DATA_DIR="/absolute/local/alternate-profile" \
DEVFLOW_DATA_PROFILE_REGISTRY_PATH="/absolute/local/alternate-registry.json" \
corepack pnpm dev:electron
```

数据库成功打开后，普通开发启动会复用该配置。使用其他目录必须配合独立注册表，或执行明确的注册表管理操作；启动过程绝不静默替换已保存选择。

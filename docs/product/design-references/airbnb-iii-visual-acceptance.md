<a id="airbnb-iii-visual-acceptance"></a>

# Airbnb-III 视觉验收

本文记录将 OpenDesign Airbnb-III 原型移植到 React/Electron 时的人工视觉验收。以下状态保留原验收记录，不代表 #171、#174、#177 新布局已经通过本表验收。

<a id="capture-command"></a>

## 截图命令

运行：

```bash
corepack pnpm visual:desktop
```

输出：

- `test-results/airbnb-iii-visual/manifest.json`
- `test-results/airbnb-iii-visual/<viewport>-<route>.png`

参考图留在本目录，不作为运行时源码。

<a id="acceptance-standard"></a>

## 验收标准

- 主要视口：`3840x2160`。
- 辅助检查视口：`1920x1080`、`1440x900`。
- 浅色主题是像素对照目标。
- 深色/跟随系统主题必须可用。
- 只有下表每项都为 `pass` 后，才能声称像素级验收完成。

<a id="manual-review-matrix"></a>

## 人工检查矩阵

| 界面 | 参考图 | 主视口截图 | 原验收状态 | 说明 |
| --- | --- | --- | --- | --- |
| 工作台 | `airbnb-iii-workbench-reference.png` | `3840x2160-workbench.png` | needs-fix（待修复） | 1920 宽度压缩已修复；节点详情仍比紧凑交接面板更偏诊断，看板密度还需最终并排调校。 |
| 团队策略 | `airbnb-iii-team-policy-reference.png` | `3840x2160-team.png` | needs-review（待复核） | CSS 收敛后核对策略矩阵密度、快照面板高度与表格行间距。 |
| 知识 | `airbnb-iii-knowledge-reference.png` | `3840x2160-knowledge.png` | needs-review（待复核） | 核对双栏布局、图谱比例与来源卡片密度。 |
| Agents | `airbnb-iii-agents-reference.png` | `3840x2160-agents.png` | needs-fix（待修复） | 主界面已使用审查/编码双面板；空运行时样例仍留下过多纵向留白，Provider 状态还位于主控制台下方。 |
| Skills | `airbnb-iii-skills-reference.png` | `3840x2160-skills.png` | needs-review（待复核） | 核对六卡片目录密度和标题标签对齐。 |
| MCP | `airbnb-iii-mcp-reference.png` | `3840x2160-mcp.png` | needs-review（待复核） | 核对表宽、行高与权限/安全列。 |
| 测试 | `airbnb-iii-tests-reference.png` | `3840x2160-tests.png` | needs-review（待复核） | 核对双面板比例、进度条和证据列表间距。 |

<a id="regression-checklist"></a>

## 回归清单

- 工作台仍显示看板来源和 `ART / EVD / TRC` 标签。
- 搜索结果可将产物和事件直接定位回节点详情。
- 团队同步后，本地和远端 Run 均保留在可见列表中。
- 节点状态矩阵与 Gate 条件矩阵仍可见。
- 将任何状态改为 `pass` 前，`corepack pnpm verify` 必须通过。

# 实施计划：工作区改造 S0 基线与核实

依据 [requirements.md](requirements.md) 与 [design.md](design.md)。S0 不改产品代码；每完成一项，记录实际运行结果。

- [x] 1. 搭建隔离运行环境
  - 新建 `scripts/workspace-baseline/environment.mts`：在 `os.tmpdir()` 下创建临时根目录、用户数据目录、数据环境注册表和示例 Git 仓库；示例仓库的测试脚本分为通过、失败、睡眠、未配置四种变体
  - 启动内存演示 Team API（空闲端口，置空数据库变量）和 Electron（加载构建产物，不设 `VITE_DEV_SERVER_URL`），并替换仓库选择对话框
  - 提供在 Electron 关闭时用 `createLocalStore({ dbPath })` 写入隔离数据库的辅助函数，先确认数据环境解析出的数据库路径
  - 在 `finally` 中关闭进程，按参数清理临时目录
  - 参考 `scripts/electron-smoke.mjs` 的 `launchApp`、API 启动方式与 `scripts/stage-agent-design-contract.mts` 的 tsx 用法，不引入新依赖；不引用 `@ai-devflow/shared/fixtures`
  - _需求：1.1, 1.2, 1.9, 3.7_

- [x] 2. 测量函数与自检
  - [x] 2.1 实现 `scripts/workspace-baseline/measure.mts`
    - 按 design 的测量定义，实现控件、字号、区域、当前位置表达、标签截断和讨论栏宽度
    - 选择器与短语由样例传入；只读 DOM，不触发交互
    - 实施说明：页面内函数放在 `measure-in-page.js`，以源码文本传给 `page.evaluate`，避免 tsx 注入页面中不存在的辅助函数。标签截断同时检查自身溢出和被横向滚动容器裁掉两种情况
    - _需求：1.3, 1.4, 1.5_
  - [x] 2.2 实现测量自检
    - 新建 `scripts/workspace-baseline/self-check/measure-page.html`，覆盖视口外文本、混合内容、隐藏元素、截断标签和已知字号
    - `--self-check` 在 Electron 中载入夹具并断言结果，失败时以非零状态退出
    - _需求：1.4, 1.5_

- [x] 3. 入口脚本与输出
  - 新建 `scripts/workspace-baseline.mts`（用 `tsx` 运行），解析 `--samples`、`--sizes`、`--theme`、`--zoom`、`--out`、`--keep-temp`、`--self-check`；参数无效时不启动任何进程
  - 设置内容区尺寸：低于 1180×760 时只在测量进程内放开最小尺寸；实际尺寸与请求不符时把该次测量标为无效
  - 写出 `metrics.json`、`manifest.json` 和 JPG 截图（CSS 像素），默认输出到 `outputs/workspace-baseline/<时间>/`
  - 写出前检查，确保不含配对码、令牌和本机用户路径
  - 在 `package.json` 增加 `baseline:workspace`，在 `scripts/check-cross-platform.mjs` 增加新脚本的检查项
  - _需求：1.6, 1.7, 1.8, 2.2, 5.4, 5.5_

- [x] 4. 主基线样例与三档尺寸
  - [x] 4.1 实现 `clarify-gate-warn` 样例（真实界面路径）
    - 确认改前界面上“节点头部”与阶段项的实际选择器，写入样例定义
    - 与 2026-09-28 走查对照：顶栏与状态条 105px、视口内控件 47 个；首个正文区块与字号的差异要能由测量方法的修正解释
    - 确认桌面进程设置 `DEVFLOW_ENABLE_DEMO_DATA` 是否影响未连接团队的状态，必要时分开设置
    - 结果（未入库，输出在 `outputs/workspace-baseline/s0-4-2*/`，任务 7 统一入库）：
      - 选择器：节点头部 `.inspector .panel-head`；状态行对照 `.inspector .node-status-summary`；阶段项 `.workflow-stage-navigation .workflow-stage-step > button`
      - 顶栏与状态条 104.59px、12 个控件，与走查一致
      - 控件 41 与 47 的差异已查明：同一页面上旧筛选得到 47 个，多出的 6 个都被滚动容器裁掉（刷新 Git 分支、项目菜单中的任务行及其操作按钮、阶段节点按钮、正文中的「查看原文」）。41 是正确口径
      - 等待提示浮层消失后再测量（浮层至少显示 8 秒）；浮层遮挡讨论栏按钮的画面另存为 `-toast` 截图，作为 L4 的证据
      - `DEVFLOW_ENABLE_DEMO_DATA` 与 `DEV_AUTH_ENABLED` 开关不影响未连接团队的首屏：状态条、节点状态摘要和概览正文完全一致，顶栏只差临时路径。保留与走查相同的设置
    - _需求：1.3, 3.1, 3.5_
  - [x] 4.2 确定三档尺寸并测量
    - 三档高度都定为 742：方案的纵向目标是绝对像素，只让宽度变化才能对比。屏幕可用区域 1920×1050，系统缩放 2 倍，三档都能实际达到
    - 1024 档低于产品窗口最小宽度 1180，由脚本在测量进程内临时放开
    - 三档数字：1440 宽 41 个控件，截断第 6 阶段；1280 宽 40 个，截断第 5、6 阶段；1024 宽顶栏折成 148.59px，状态行对照下移到 480px，38 个控件，截断第 3–6 阶段，讨论栏占主区 49.9%
    - 深色主题与 200% 缩放的截图已保存。200% 缩放时顶栏与状态条占内容区 60%（222.6/371），主区只剩约 148px，看不到正文首个区块
    - 实施说明：Playwright 截取缩放后的 Electron 页面会被裁切，缩放截图改用 `webContents.capturePage()`
    - _需求：2.1, 2.2, 2.3, 2.4_

- [x] 5. 其余状态样例
  - [x] 5.1 Gate 与材料类样例
    - `clarify-gate-suggestions`、`clarify-gate-clean`、`gate-enforced-block`、`upstream-waiting`、`clarify-history`、`design-gate`
    - 结果：全部制备成功。Fake Provider 总会给出测试建议，`clarify-gate-clean` 改为在应用关闭时改写审查（store）；强制阻断的原因是缺少审查
    - _需求：3.1, 3.2, 3.3, 3.4_
  - [x] 5.2 执行类样例
    - `build-running`（受控模型服务挂起响应）、`build-permission`、`build-interrupted`；瞬时状态现场截图
    - 结果：另加 `test-stage`、`pr-ready`，补齐六阶段。编码需要团队连接与预算，这些样例都先经配对表单连接
    - _需求：3.2, 3.3, 3.4_
  - [x] 5.3 测试证据样例
    - 方案 6.4 节的七种情况；读取失败在清单中注明只做渲染层验证
    - 结果：测试只能在测试节点运行，并在托管工作树中执行。执行类样例先快进到测试节点、改写工作树的 test 脚本，再在测试页点击执行；超时等待真实的 120 秒。“被跳过”不是证据状态，未单独制备
    - _需求：3.2, 3.4, 3.6_
  - [x] 5.4 团队连接与上传样例
    - `team-unpaired`、`team-paired`、`team-existing-credential` 与 `upload-*` 五种情况
    - 配对一律走正常配对表单；截图期间保持 API 运行
    - 结果：另加 `policy-unavailable-after-reload` 与 `upload-credential-invalid`。“正在上传”靠在主进程中暂时挂起 `/api/sync` 请求保持到截图完成；“没有凭据”在应用关闭时删除本地凭据（store）
    - _需求：3.2, 3.3, 3.4, 3.7_
  - [x] 5.5 交付、验收与讨论样例
    - `pr-approval`、`acceptance`（直接写入，只用于布局）、`discussion-empty`、`discussion-messages`
    - 所有样例都写清方案条目、制备方式、是否模拟与局限，并在主基线尺寸下截图
    - 结果：`pr-approval` 需要 GitHub 替身，改为 renderer 并写明替代验证；空讨论由主基线样例覆盖，不单列
    - _需求：3.1, 3.2, 3.4, 3.5, 3.6_

- [x] 6. 核实待验证项
  - 以 design 中“待验证项的初步结论”为起点，在隔离环境中逐项运行确认；记录结论、依据、置信度、步骤与所用样例
  - 第 1 项通过正常绑定表单重做；D3 区分“没有凭据”与“其他项目已配对”
  - 第 5 项补一条 `saveDesktopPairingCredential` 的单元测试：同一团队项目重新配对也会撤销进行中的交付
  - 结果：7 项都有结论，第 6、7 项只有代码阅读依据。另有新发现 X1–X6。单元测试补了两条：同一团队项目重新配对会撤销；保存相同凭据不撤销
  - _需求：4.1, 4.2, 4.3, 4.5_

- [x] 7. 基线报告与方案回写
  - 用 `--out docs/validation/evidence/workspace-redesign-s0-<YYYYMMDD>/` 完整运行一次，并写 `docs/validation/workspace-redesign-s0-baseline-<YYYYMMDD>.md`
  - 报告汇总三档指标、样例清单和待验证项结论，标明哪些来自模拟、哪些用 IPC 或直接写入准备
  - 更新方案：2.2 节“现状”列、2.3 节待验证项，必要时更新 6.5 节与 P1；补修订记录；状态行注明 S0 已完成并链接报告
  - 结果：基线在 `docs/validation/evidence/workspace-redesign-s0-20260928/`（深色与 200% 缩放在 `variants/`），报告为 `docs/validation/workspace-redesign-s0-baseline-20260928.md`；方案升到第 5 版，另更新了 6.4 节与 S1 的改动清单和验收
  - _需求：4.4, 5.1, 5.2, 5.3, 5.6_

- [x] 8. 验证
  - 运行 `corepack pnpm verify` 和 `tsx scripts/workspace-baseline.mts --self-check`；复查入库的截图与 JSON 不含凭据、配对码和本机用户路径
  - 在报告中记录实际命令与结果，说明哪些用了模拟、哪些没有覆盖
  - 结果：verify 通过（4164 项测试，跨平台检查含新脚本）；自检 7 项通过；入库 JSON 未发现本机用户路径、令牌、配对码或合成 API Key；临时目录与子进程均已清理
  - _需求：1.9, 5.4, 5.5_

<a id="adr-0004-shared-theme-token-strategy"></a>

# ADR 0004：共享主题设计变量

<a id="status"></a>

## 状态

已接受（Accepted）。

<a id="context"></a>

## 背景

桌面应用和 Web 控制台都需要支持浅色、深色以及跟随系统主题。

<a id="decision"></a>

## 决策

共享主题名称和 CSS 变量。组件使用语义化设计变量，不硬编码颜色。桌面在本地保存主题偏好；Web 在浏览器 localStorage 中保存 system/light/dark 选择，并在页面内容绘制前通过文档头部应用主题，由 CSS 跟随系统变化。存储失败时回退到系统主题，但不妨碍页面内切换。退出登录后，同一公开源上的主题偏好仍保留。按账户同步 Web 偏好属于后续工作。

<a id="consequences"></a>

## 影响

- Electron 与 Web 采用一致的界面语言。
- 工作流画布、日志、差异、图表和图谱可以分别调整，以适应低眩光深色主题。

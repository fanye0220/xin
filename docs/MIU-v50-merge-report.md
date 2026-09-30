# MIU v50 Web 功能融合说明

本包以最新「改 UI」版本为 UI / 布局 / 字体 / 已修复 Bug 的唯一基准。

## 本次迁移
- 保留最新改 UI 的全部视觉、布局和组件实现。
- 保留已有 MIU v50 Web 功能层：BBCode、气泡主题、HTML 状态块解析、壁纸、正则处理、开场白阅读器等。
- 重新迁移 Web 端聊天导入增强：JSONL / TXT / ZIP。
- Web 端不显示 Android 更新检查；更新检查仅在 Android 环境执行。

## 明确没有覆盖
- 最新改 UI 的字体与 CSS。
- 最新改 UI 的侧栏、壁纸交互、GreetingReader、CharacterDetail 等已修复实现。
- 最新改 UI 的其它组件改动。

## 验证
- TypeScript / Vite 构建应在安装项目依赖后执行 `npm run build`。

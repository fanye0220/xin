# MIU Web — 改 UI + MIU v50 功能融合版

这是以「改 UI」为最终视觉/布局基线、融合 MIU v50 Web 功能的纯 Web 工程。

## 原则

- 页面布局、主题、侧栏、聊天渲染、版本管理等以改 UI 为准。
- MIU v50 只补齐缺失功能，不覆盖现有 UI。
- Web 不执行 Android 更新检查/更新弹窗。
- 支持 JSON / JSONL / TXT / ZIP 聊天记录导入。

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 部署

项目根目录就是 Web 工程根目录，可直接用于 Vercel / GitHub Actions 等静态构建流程。

详细合并说明见 `docs/MIU-v50-merge-report.md`。

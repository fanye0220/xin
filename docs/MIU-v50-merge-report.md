# MIU v50 + 改 UI Web 合并说明

## 合并原则

- **改 UI 包是最终 UI / 布局基准**：不使用 MIU v50 的页面布局、按钮排布、主题样式去覆盖现有改 UI。
- MIU v50 只作为功能来源；只有在改 UI 中缺失或确实需要补齐的功能才迁移。
- 发现改 UI 已经有更完整实现的地方，保留改 UI 版本，不做降级覆盖。

## 本次已融合

### 1. Web 端更新检查隔离
- 保留改 UI 的整体 App 布局。
- `checkForAppUpdates()` 和更新弹窗仅在 Android 环境运行。
- Web/Vercel 版本不会在启动后弹出 Android 更新流程。
- 设置里的「关于与更新」标签仅 Android 显示。

### 2. 聊天记录导入能力补齐
在不改变现有聊天页面 UI、气泡主题、正则开关等功能的前提下，补入 MIU v50 的导入能力：
- JSONL 统一解析。
- TXT 对话日志导入。
- ZIP 内的 JSON / JSONL / TXT 批量解析。
- 保留原有 `sanitizeChatMessages` 数据清洗与现有聊天元数据结构。
- 文件选择器增加 `.txt`。

### 3. 解析层
新增 `src/lib/chatParse.ts` 的 `parseJsonlChat()`，用于过滤聊天头信息、工具/预设/角色卡等非消息对象。

## 明确保留“改 UI”的实现（没有用 MIU 覆盖）

- `MessageContent.tsx`：改 UI 版本包含更完整的 TavernHelper / SillyTavern 交互模拟、HTML iframe、自适应高度和分支/问候语跳转能力。
- `chatParse.ts`：改 UI 的 TXT 多行说话人解析更完整；只额外吸收 MIU 的 JSONL 独立解析函数。
- `CharacterVersionsSection.tsx`：改 UI 有版本切换指示、版本对比、备注编辑等更完整的版本管理体验。
- `FolderSidebar.tsx`：完全保留改 UI 的布局、壁纸、主题和交互。
- `index.css`：完全保留改 UI 的主题/视觉体系。
- `types/tavern.ts`、`png.ts`、`worldbook.ts`：改 UI 版本代码更完整，不做反向覆盖。

## 需要你决定的 MIU 实现

### A. MIU v50 聊天导入“按 AI 名称自动绑定角色”
MIU v50 在导入聊天时，会尝试从消息中的 AI `name` 匹配本地角色并自动绑定。

当前版本**暂不强制加入**，原因是改 UI 已经有自己的聊天导入与角色上下文逻辑。若你希望，我可以再把这个功能作为独立开关加入，避免错误匹配。

### B. MIU v50 `db.ts` 的角色卡识别规则
MIU v50 的版本相较改 UI：
- 移除了部分 `chara_card_v1` 识别；
- 缩减了 `alternate_greetings` 等字段参与角色卡判定的范围；
- 同时简化了一些角色内容字段。

这不属于明确的“更好”，而且可能增加边缘卡/旧格式误判风险，所以本次没有覆盖改 UI 的识别逻辑。

### C. MIU v50 头像兜底 SVG
MIU v50 的机器人兜底头像视觉方案与改 UI 不同。本次保留改 UI 版本，不强行改变你现在的视觉效果。

## 结论

最终包是“**改 UI 外观 + MIU v50 功能补齐**”的 Web 基线，不是简单的 MIU 覆盖包。

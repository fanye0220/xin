# MIU

角色卡与酒馆（SillyTavern）资源管理工具，纯前端 Web 应用（React 19 + Vite + Tailwind CSS 4）。

## 功能概览

- 角色卡库管理：导入 / 导出、文件夹分类、标签、批量操作、重复卡片检测与清理
- 酒馆资源管理：世界书、预设、快速回复（QR）、正则脚本、美化资源的分类归档
- 聊天记录：查看、解析、清理，支持剧场与备忘录
- 云端同步：基于 Firebase 的卡库与工具区同步，支持云盘上传下载
- AI 辅助：AI 推荐、自动打标签（使用自定义 OpenAI 兼容接口）
- 移动端适配：可打包为 Android 应用（Capacitor）

## 本地运行

环境要求：Node.js 18 或更高版本。

```bash
npm install
npm run dev
```

开发服务器默认运行在 http://localhost:3000

## 构建

```bash
npm run build
```

产物输出到 `dist/` 目录，可直接作为静态站点部署。

本地预览构建结果：

```bash
npm run preview
```

## 部署到 Vercel

1. 把本目录推送到 GitHub 仓库
2. 在 Vercel 中 **Add New → Project**，选择该仓库
3. Framework Preset 选 **Vite**（仓库内已有 `vercel.json`，一般会自动识别）
4. Build Command：`npm run build`，Output Directory：`dist`
5. 点击 Deploy

其他静态托管平台（Netlify、Cloudflare Pages、GitHub Pages）同理：构建命令 `npm run build`，发布目录 `dist`。

## 配置说明

本应用为纯前端应用，**不需要配置任何服务端环境变量**即可运行：

- **AI 接口**：在应用内「设置」中填写自定义 OpenAI 兼容接口的地址、密钥与模型名，配置保存在浏览器 localStorage，不经过服务端。
- **云端同步**：使用 `firebase-applet-config.json` 中的 Firebase 项目配置，按需替换为你自己的项目配置即可。
- **版本更新检查**：默认从 `https://raw.githubusercontent.com/fanye0220/miu/main/version.json` 拉取版本信息，可在应用内「设置」中修改该地址，或直接编辑 `src/config/version.ts`。

全部配置均在应用内完成，仓库中不需要、也不包含任何 `.env` 文件。

## 目录结构

```
src/
├── App.tsx                 # 应用入口与主框架
├── config/version.ts       # 版本号与更新检查
├── components/             # 界面组件
├── lib/                    # 核心逻辑
│   ├── db.ts               # 本地数据库（IndexedDB）
│   ├── cloudDrive.ts       # 云端同步
│   ├── png.ts              # 角色卡 PNG 读写
│   ├── worldbook.ts        # 世界书解析
│   └── ...
└── types/tavern.ts         # 酒馆数据类型定义
```

## 许可证

未指定。

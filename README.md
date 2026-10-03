# MIU — 角色卡与酒馆资源管理工具

纯前端的角色卡 / 酒馆（Tavern）资源管理器：本地管理角色卡、世界书、预设、快速回复、聊天记录与版本快照，可选接入云盘同步和自己的 AI 接口。

技术栈：React 19 + TypeScript + Vite 6 + Tailwind CSS 4。数据默认存在浏览器 IndexedDB，不依赖后端服务。

当前版本：3.0.5

## 一、部署到 Vercel

1. 把本目录内容提交并推送到 GitHub 仓库。
2. 打开 vercel.com → Add New… → Project → 选中该仓库 → Import。
3. 参数全部由仓库里的 `vercel.json` 提供，不用手改：
   - Framework Preset：`Vite`（一般会自动识别）
   - Install Command：`npm install --no-audit --no-fund`
   - Build Command：`npm run build`
   - Output Directory：`dist`
4. 直接 Deploy，首次构建约 1～2 分钟。
5. 不需要配置任何环境变量：AI 功能在应用内「设置 → AI 接口」里填写接口地址和 Key，代码不读环境变量。
6. 部署完成后用 Vercel 给的域名访问即可；`vercel.json` 已配好 SPA 重写，刷新页面不会 404。

> `vercel.json` 里显式指定用 npm 安装：即使仓库里同时存在 `bun.lock`，Vercel 也不会改用 bun。

## 二、本地运行

```bash
npm install
npm run dev        # 开发服务器 http://localhost:3000
npm run build      # 生产构建，产物在 dist/
npm run preview    # 本地预览 dist/
npm run lint       # tsc --noEmit 类型检查
```

## 三、网页版与本地应用的区别

网页版靠 `src/lib/appBridge.ts` 的 `isAndroid()` 判断运行环境，下面两处只有打包成本地 App（Android）时才会出现，网页部署里自动隐藏：

- 导入窗口里的「拉取酒馆卡片」（走本地 App 的 Java 桥接，浏览器里用不了）
- 设置 → 关于与更新 →「版本自动检查 / 检查更新」，以及启动 3 秒后的静默版本检测（那是给本地 App 发版推送用的）

版本号只维护一处：`src/config/version.ts` 的 `CURRENT_APP_VERSION`（主页和设置页都读它）。

## 四、目录说明

| 路径 | 说明 |
| --- | --- |
| `src/components/` | 界面组件（角色列表、详情、聊天记录、打标、云盘、导入等） |
| `src/lib/` | 数据与工具层（IndexedDB、云盘 Drive、导入导出、PNG 卡解析、聊天记录解析等） |
| `vercel.json` | Vercel 部署配置（安装/构建命令、输出目录、SPA 重写） |
| `firebase-applet-config.json` | 云盘同步用的 Firebase 配置，代码里直接 import，请保留 |
| `capacitor.config.ts`、`AndroidBridgeInstructions.md` | 打包安卓 App 用；只做网页版可以忽略 |
| `合并说明.md` | 各版本合并记录，可自行删除 |

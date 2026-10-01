# MIU Web

MIU 的纯 Web 部署工程。业务代码以 MIU v50 为基础，UI 采用独立 UI 版本的视觉主题。

## 本地运行

```bash
npm install
npm run dev
```

## 生产构建

```bash
npm run build
```

构建结果位于 `dist/`。

## Vercel

- Framework Preset：Vite
- Build Command：`npm run build`
- Output Directory：`dist`
- Install Command：`npm install`

项目已包含 SPA 路由回退配置，可直接连接 GitHub 仓库部署。

# Tingfe — 公开项目

GitHub Pages 个人项目落地页。页面只读取 `Tingfe` 账号的**公开仓库**，明确区分原创仓库与 Fork。仓库标题、语言、更新时间及项目网站来自 GitHub API；描述为空时尝试提取公开 README 的首段并标注来源，不自动编造项目介绍。

## 自动更新

`.github/workflows/pages.yml` 在 `main` 推送、手动运行，以及每 6 小时执行一次。`scripts/build.mjs` 读取公开仓库并生成静态 HTML，随后部署到 GitHub Pages。GitHub 定时任务可能排队或延迟；手动运行 `workflow_dispatch` 可立即触发刷新。

## 本地预览

```sh
node scripts/build.mjs
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

打开 <http://127.0.0.1:8765/>。无需安装依赖。

若本地构建遇到 GitHub 匿名 API 限流，使用 `GITHUB_TOKEN="$(gh auth token)" node scripts/build.mjs`。Actions 构建已自动提供 token。

## 内容维护

修改仓库的 GitHub Description、语言或 Homepage 后，下次构建自动体现。要改变页面文案或设计，请编辑 `site/`。站点仓库 `tingfe.github.io` 本身不显示在项目列表中。

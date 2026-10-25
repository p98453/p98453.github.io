# 小牛壮士

林勇的个人博客，[kukudelin.top](https://kukudelin.top)。静态站点用 [Astro](https://astro.build) 从 `content/posts/` 的 Markdown 生成，由 GitHub Actions 部署到 GitHub Pages。

## 本地预览

需要 Node.js 22。

```bash
npm install
npm run dev
```

浏览器打开终端里给出的本地地址。生产构建：

```bash
npm run build
npm run verify
npm run preview
```

`verify` 会检查文章数量、图片是否进了构建结果，以及 `dist/CNAME` 是否为 `kukudelin.top`。

## 写一篇新文章

在 `content/posts/` 放一个 Markdown 文件。文件名用 `日期-标题.md`，图片放在同名文件夹里。

```text
content/posts/2026-10-25-我的新文章.md
content/posts/2026-10-25-我的新文章/图.png
```

```markdown
---
title: 我的新文章
date: 2026-10-25 10:00:00
categories:
  - 实习笔记
tags:
  - 示例
---

正文从这里开始。

![说明](2026-10-25-我的新文章/图.png)
```

不需要改配置，也不需要重新登记目录。推到 `blog-source` 之后，Actions 会构建并发布。

约定：

- 页面地址是 `/:年/:月/:日/:文件名里日期后面的那段/`。日期取前言里的 `date`，不是文件名里的日期，这样和原来的 Hexo 链接一致。新文章请让文件名日期和 `date` 使用同一天。
- `categories` 里的 `/` 会变成分类地址里的 `-`，例如 `工具/部署` 对应 `/categories/工具-部署/`。
- 代码块会高亮，`$...$`、`$$...$$` 和 `\(...\)` 会按数学公式渲染。
- 图片地址写成相对路径即可，构建时会放到文章自己的目录下。

## 部署

工作流：`.github/workflows/pages.yml`。

- 针对 `blog-source` 的 pull request 只构建并运行 `verify`。
- 推送到 `blog-source` 时，构建结果会通过 GitHub 官方的 Pages actions 发布。
- 构建产物根目录包含 `CNAME`，内容是 `kukudelin.top`。

站点现在仍由 `master` 分支上的旧 Hexo 静态文件提供。切换到这套站点需要仓库所有者在 GitHub 上改一处设置，见 pull request 说明。在那之前合并本分支不会替换线上页面。

## 内容说明

`content/posts/` 顶层有 60 篇 Markdown。另外有一篇历史文章放在自己的文件夹里：`content/posts/2026-06-11-博客RAG知识库问答搭建/2026-06-11-博客RAG知识库问答搭建.md`。站点会把它和原来的地址一起发布，所以构建结果是 61 篇。

有两张图在正文里被引用，但源文件和现有的 `master` 分支里都不存在，页面上会留空：

- `2026-02-12-Git与GitLab的实战.md` 里的 `image-20260112230959985.png`（原来指向本机桌面路径）
- `2026-02-12-docker笔记.md` 里的 `Docker笔记/image-20260111215335802.png`

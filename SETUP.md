# 个人随想上线还要做的事

静态博客仍然由 GitHub Pages 发布，`CNAME` 不要改。随想的申请、审核和正文走 Cloudflare Worker，正文不进 `dist/`。

下面每一项都还没在这个仓库里完成。做完之前，网站上的申请表会因为连不上 Worker 而显示「网络抖了一下，没送出去」。

## 账号

1. Cloudflare 账号，开通 Workers 免费额度，并创建一个 KV namespace。
2. Resend 账号。发信域名要在 Resend 里验证，建议用 `thoughts.kukudelin.top` 或整个 `kukudelin.top`。
3. 域名 DNS 要能给 `thoughts.kukudelin.top` 加一条记录。如果域名在 Cloudflare，把这条记录设为已代理，再绑到 Worker。GitHub Pages 继续托管 apex `kukudelin.top`。
4. 可选：Cloudflare Turnstile。默认关闭，不创建也行。

## 配置（不是密钥，已经写在 `worker/wrangler.toml`）

| 变量 | 当前值 | 作用 |
| --- | --- | --- |
| `OWNER_EMAIL` | `3224688576@qq.com` | 审核信收件人 |
| `ALLOWED_ORIGIN` | `https://kukudelin.top` | 浏览器跨域只允许这个来源 |
| `SITE_ORIGIN` | `https://kukudelin.top` | 入口打开后回到的站点 |
| `WORKER_ORIGIN` | `https://thoughts.kukudelin.top` | 审核链接，以及通过信里的一次性入口 |
| `RESEND_FROM` | `林勇 <thoughts@kukudelin.top>` | Resend 发件人，域名必须已验证 |

KV 的 `id` 和 `preview_id` 仍是占位符 `REPLACE_WITH_KV_NAMESPACE_ID`。

前端请求地址在 `src/lib/site.js` 的 `thoughtsApi`，目前是 `https://thoughts.kukudelin.top`。换主机的话要同时改这里和 `WORKER_ORIGIN`，然后重新构建博客。

## 密钥（只能用 wrangler secret，不要写进仓库）

在 `worker/` 目录执行：

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put HMAC_SECRET
npx wrangler secret put UPLOAD_TOKEN
```

| 密钥 | 用途 |
| --- | --- |
| `RESEND_API_KEY` | 调用 Resend 发信 |
| `HMAC_SECRET` | 给同意 / 拒绝 / 收回链接签名 |
| `UPLOAD_TOKEN` | 上传 Markdown 的 Bearer |

可选，不设置就保持关闭：

```bash
npx wrangler secret put TURNSTILE_SECRET
```

打开 Turnstile 时，还要把站点密钥写进 `src/lib/site.js` 的 `turnstileSiteKey`（这是公开值，不是密钥），并在申请表里接上组件。现在表单不渲染 Turnstile。

## 部署顺序

1. `cd worker && npx wrangler kv namespace create THOUGHTS`
2. 再执行一次 `npx wrangler kv namespace create THOUGHTS --preview`
3. 把两个 id 填进 `worker/wrangler.toml`，替换占位符。
4. 按上一节写入三个密钥。
5. 确认 `RESEND_FROM` 的域名已在 Resend 验证。
6. `npx wrangler deploy`
7. DNS：`thoughts.kukudelin.top` 指向这个 Worker。不要改仓库里的 `CNAME`。
8. 在本机建一个不会提交的目录 `private-thoughts/`（已在 `.gitignore`），放入带 frontmatter 的 Markdown：

```markdown
---
title: 标题
date: 2026-10-20
slug: rainy-afternoon
---

正文。不要把这个目录放进公开站点。
```

9. 上传：

```bash
UPLOAD_TOKEN='刚才设置的值' node scripts/upload-thoughts.mjs private-thoughts
```

`UPLOAD_TOKEN` 放在环境变量里，不要写成命令行参数以外的仓库文件。脚本只从环境变量读取。

10. 打开 `https://kukudelin.top/thoughts/` 提交一次申请，确认 QQ 邮箱收到审核信。点开「同意」或「拒绝」后还要在确认页再按一次，避免邮箱预览把链接提前点掉。

## 还缺什么

- Cloudflare KV namespace 的真实 id
- 三个密钥的实际值
- Resend 域名验证
- `thoughts.kukudelin.top` 的 DNS 和 Worker 路由
- `private-thoughts/` 里的真实文章，以及第一次上传
- 可选的 Turnstile 站点密钥和 `TURNSTILE_SECRET`

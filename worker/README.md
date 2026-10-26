# 个人随想 Worker

申请、审核邮件和正文都在这里。静态站点只放空壳页面，不放随想正文。

完整的账号、密钥和 DNS 清单见仓库根目录的 [SETUP.md](../SETUP.md)。

## 本地检查

在仓库根目录：

```bash
node scripts/test-thoughts.mjs
```

## 部署

```bash
npx wrangler kv namespace create THOUGHTS
npx wrangler kv namespace create THOUGHTS --preview
```

把打印出来的 id 写进 `wrangler.toml`，替换 `REPLACE_WITH_KV_NAMESPACE_ID`。然后：

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put HMAC_SECRET
npx wrangler secret put UPLOAD_TOKEN
npx wrangler deploy
```

`OWNER_EMAIL` 等非密钥变量在 `wrangler.toml` 的 `[vars]`。

## 路由

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| POST | `/api/apply` | 提交答案和邮箱 |
| POST | `/api/session` | 用入口 token 换 HttpOnly cookie |
| POST | `/api/logout` | 清掉这次会话 |
| GET | `/api/thoughts` | 已解锁时返回目录 |
| GET | `/api/thoughts/:slug` | 已解锁时返回一篇 Markdown |
| GET/POST | `/review` | 打开确认页，再提交才同意、拒绝或收回 |
| PUT | `/admin/thoughts` | Bearer `UPLOAD_TOKEN` 上传一篇 |
| DELETE | `/admin/thoughts/:slug` | 删除一篇 |

浏览器来源只接受 `ALLOWED_ORIGIN`。管理接口拒绝带 `Origin` 的请求。

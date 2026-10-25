---
title: AI Coding Skill 设计方法论：从硬编码到可迁移配置驱动
date: 2026-06-11 12:00:00
categories:
- 工具/部署
---

# 一句话总结

> 好的 AI Coding Skill = **配置外置** + **工作流闭环** + **占位符解耦**。本文以真实 Skill 的 5 次迭代为线索，展示如何把一个"能用"的脚本变成一个"谁拿过去改一行配置就能用"的独立 Skill。

---

# 问题背景

## 我在做什么

在 Hexo 博客项目中维护一个 `knowledge_record` Skill——它能在我和 AI 对话结束后，自动萃取对话中的技术知识点，生成结构化的博客文章（模板化），预览后一键发布到线上。

## 遇到了什么问题

第一个版本"能用"但**迁不走**：

- 所有路径写死了 `d:/Blog/source/_posts`，换台机器就崩
- 跨平台不兼容——Windows 的 `del` 命令到 Linux 直接报错
- 发布命令 `hexo clean && hexo generate && hexo deploy` 散落在 skill.md 的 3 个地方，改一处忘一处
- 工作流不闭环：能生成能发布，但忘了加**预览确认**和**删除**环节

## 复现

把整个 `skills/knowledge_record/` 文件夹拷贝到另一台 Mac 上——技能直接不可用。

---

# AI 分析过程

## AI 的定位思路

本对话中，AI 做了 3 轮全局扫描：

1. **全量收集**：用 `launch_subagent` 并行读取 `_config.yml`、`CNAME`、`config.json`、`skill.md`、`template.md`、`README.md`、`examples/`、`source/` 目录
2. **交叉对比**：发现 config.json 的 `posts_dir` 和 skill.md 中硬编码的 `source/_posts/` 不一致
3. **逐项消歧**：用 `grep_search` 搜索所有残留的硬编码路径和命令

## 关键发现

| 问题 | 根因 | 影响 |
|------|------|------|
| 路径硬编码 | skill.md 直接写了 `d:/Blog/source/_posts/` | 换个盘符就崩 |
| 跨平台不兼容 | `del /f /q` 是 Windows 专属 | Linux/Mac 报错 |
| 命令散落 | 发布命令在 skill.md 里出现 3 次 | 改一处漏一处 |
| 工作流缺失 | 没有预览→确认环节，没有删除流程 | 安全感和控制感差 |

## 涉及的技术概念

- **{key} 占位符模式**：skill.md 中用 `{source_dir}` `{posts_dir}` 等占位符引用配置，运行时从 config.json 动态映射
- **Hexo 博客框架**：基于 Node.js 的静态博客生成器，核心命令 `hexo clean` / `hexo generate` / `hexo deploy`
- **Skill 独立封装**：将 trigger、workflow、template、config 打包为自包含目录，迁移时只改 config.json
- **Frontmatter**：Markdown 文件的 YAML 元数据块（`---` 包裹），Hexo 用它解析标题、日期、标签等

---

# AI 解决方案

## 最终方案

不重写，用**最小 delta 修改**逐轮迭代，总共 5 轮对话完成：

| 轮次 | 触发 | 改动 |
|------|------|------|
| 第1轮 | 分析项目 | 修 `_config.yml` 的 `url` → 统一到 `kukudelin.top` |
| 第2轮 | "直接同步到博客" | skill.md 增加 Step 发布 → 生成完自动 `hexo deploy` |
| 第3轮 | "让我预览+询问" | 发布前插入**预览→确认**环节 |
| 第4轮 | "要支持删除" | 新增 Step D1~D4 删除流程 + 触发词 |
| 第5轮 | "终检迁移" | 全量 {key} 替换 + 交叉校验 |

核心原则：**skill.md 是 immutable 的规则，config.json 是唯一可变配置点**。

## 核心代码片段（如有）

**config.json — 配置外置的关键：**

```json
{
  "hexo": {
    "source_dir": "d:/Blog",
    "site_url": "https://kukudelin.top",
    "posts_dir": "source/_posts",
    "deploy_command": "hexo clean && hexo generate && hexo deploy"
  }
}
```

**skill.md — 工作流 Step 0（加载配置）：**

```
Step 0：加载配置
读取 config.json，建立占位符映射表：
  {source_dir}    →  hexo.source_dir
  {posts_dir}     →  hexo.posts_dir
  {deploy_command}→  hexo.deploy_command
本 Skill 所有文件操作均使用占位符，绝不硬编码路径。
```

## 为什么这样做能解决问题

**{key} 占位符的本质是接口抽象**——就像面向对象编程中的 interface。skill.md 定义"我需要什么"，config.json 提供"当前环境下的具体值"。迁移到 Mac 时，只改 config.json 里的 `source_dir` 从 `d:/Blog` 到 `/Users/xxx/blog`，skill.md 一行不动。

跨平台问题上同理：`hexo clean && hexo generate && hexo deploy` 在所有平台都能跑，替代了 Windows 专属的 `del /f /q`。

---

# 本次知识萃取

## 显性知识

- **Hexo Skill 架构**：trigger → config → workflow → template → output
- **{key} 占位符模式**：skill.md 中用占位符引用配置值，config.json 提供映射
- **跨平台 Shell**：优先用框架命令（`hexo clean`）而非 OS 命令（`del`）
- **Frontmatter 规范**：Hexo 需要 `title`/`date`/`tags`/`categories` 等字段

## 隐性知识

- **最小 delta 原则**：每轮迭代只改 1-2 处，改完立即验证，不搞大爆炸重构
- **终检兜底**：在声称"完成"之前，用 `grep_search` 全局搜索残留硬编码，防止口是心非
- **预览→确认→发布**三步闭环比全自动更能建立用户信任——"慢"即是快
- **迁移测试是最好的设计审查**：假装把 skill 拷贝到另一个环境，立刻暴露所有硬编码问题

## 关联知识

```
AI Coding Skill 设计
    ↓
配置驱动的 Agent 行为树
    ↓
LangChain / Semantic Kernel 的 Plugin 模型
    ↓
微服务配置中心 (Consul / Nacos)
    ↓
基础设施即代码 (IaC)
```

---

# 安全思考

本场景的安全考量：

- **攻击面**：Skill 自动执行 `hexo deploy`，如果 config.json 被篡改，可能推送到恶意仓库——需保护 config.json 的写入权限
- **DoS 风险**：`hexo generate` 在文章量极大时可能 OOM——对于个人博客（< 200 篇）无影响
- **权限问题**：自动写入 `source/_posts/` 目录，需确保目录权限正确
- **数据泄露**：对话内容被萃取到博客，需注意是否包含敏感信息（API Key、内部架构细节等）——本 Skill 由用户预览确认后才发布，已提供人工兜底

---

# 延伸学习路线

```
Hexo 博客搭建与基础命令 (hexo new, generate, deploy)
    ↓
AI Coding Skill 设计模式 — 本文
    ↓
Agent 工作流引擎 (LangGraph / Temporal)
    ↓
配置管理 (JSON Schema → 配置校验 → 配置中心)
    ↓
可观测性：给 Skill 加日志、metrics、tracing
```

---

# 面试视角

## 可能会怎么问

> "你设计过一个可以从零迁移的 AI Coding Skill，具体是怎么做到环境无关的？"

## 你可以怎么答

回答框架（3 层递进）：

1. **问题定义**：说出硬编码的 3 个痛点——路径、平台、命令散落
2. **设计决策**：配置外置（config.json）+ 占位符（{key}）+ 规则不可变（skill.md），类比 interface/impl 分离
3. **验证手段**：迁移测试 + `grep_search` 终检——设计不是一次性完成的，是迭代修补出来的

核心金句：**"skill.md 是 interface，config.json 是 impl，迁移就是换个 impl"**。

---

# 我的收获

最大的认知 shift：**"能用"离"可迁移"差着至少 3 轮迭代**。第一版写完觉得好了，一拷到别处立刻暴露问题——路径硬编码、平台不兼容、命令散落、工作流缺失。这些问题在"原地"运行时永远不会暴露，只有当你强迫自己做迁移测试，才会发现。

还有一个意料之外的体验：**让用户预览再发布，比全自动更能建立信任**。全自动是"你相信我不出错"，半自动是"你随时可以阻止我"——后者反而让用户更放心地把流程交给 AI。

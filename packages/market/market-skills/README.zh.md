---
description: "市场技能类型、已安装技能提供方和启用状态 Remote。"
kind: "package-reference"
---

# @deepseek-ai/dsh-market-skills

[English](README.md) | 中文

## 概述

`dsh-market-skills` 注册市场技能类型，从 ZIP 或 Markdown 导入个人技能，通过 `ctx.marketSkills` 提供市场技能和个人技能，并将已安装的市场目录接入共享技能注册表。所有技能来源共用一个启用状态设置，个人技能可以从其所在文件夹删除。

## 目录

- [使用此包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

将此包与 `dsh-market`、技能注册表、settings 和 working-directory 服务一起挂载。使用 `marketSkills` Remote 列出已安装技能、读取技能文档、修改启用状态或删除个人技能。市场下载由市场的 `uninstallPackage` 删除。`uninstallPersonal` 从 `<DSH home>/skills` 或 `~/.agents/skills` 删除个人技能的目录或其 Markdown 文件；对链接进来的技能只删除链接，保留被链接的目录；其他来源的技能一律拒绝删除。

`importSkill({ fileName, data }, signal)` 接收一个编码为规范 base64 的 `.zip` 或 `.md` 文件，根据 `SKILL.md` frontmatter 中的名称安装到 `<DSH home>/skills/<name>`。Markdown 必须是有效 UTF-8，并包含有效的 YAML frontmatter、名称、描述和调用策略。ZIP 接受根目录中的 `SKILL.md` 或一层外部文件夹，保留资源，拒绝额外嵌套的技能、不安全路径、链接和冲突的文件名。导入不会执行脚本或安装依赖。

导入不设置字节大小或 ZIP 条目数量限制。校验失败返回 `market-skills/import-invalid`；已存在的可见技能、停用技能或个人目标路径返回 `market-skills/import-conflict`，保留原内容。发布前的文件操作失败返回 `market-skills/import-failed`。发布前取消会清理暂存目录；发布完成后直接返回名称，不再读取列表。已有的按名称停用设置继续生效。

<a id="understand-the-implementation"></a>
## 实现说明

市场提供方只提供有安装记录的市场下载；个人目录由现有文件系统技能提供方发现。管理读取使用默认 preset 的作用域。导入在技能根目录外的私有目录中解压，使用提供服务时的解析器校验，在与个人技能删除共用的跨进程锁下检查同名冲突，再发布完整目录并使注册表缓存失效。卸载插件会取消并等待已经开始的导入。管理 Remote 在切换启用状态时写入共享 `disabled` 设置。

<a id="model-experience"></a>
## 模型体验

### 已安装技能提供方

#### 模型看到的内容

启用的技能可以出现在面向模型的 `skill` 目录中，并通过现有 `skill` 工具加载。此包提供已安装内容和策略；渲染仍由共享技能消费者负责。

#### Token 影响

调用技能时由现有技能消费者加入选中的技能正文；此包不增加独立提示词。

#### KV Cache 影响

技能目录变化通过现有消费者追加替换目录；此包不会编辑旧的模型消息。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 市场下载依赖 `dsh-market`；个人上传使用内存传输，不支持替换或合并。启用状态由共享 settings 服务保存。
- 停用的技能仍会安装并对管理调用方可见，但普通模型和用户读取会将其过滤掉。

### 开发备注

<a id="dev-note"></a>

无。

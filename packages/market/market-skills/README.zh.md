---
description: "市场技能类型、已安装技能提供方和启用状态 Remote。"
kind: "package-reference"
---

# @deepseek-ai/dsh-market-skills

[English](README.md) | 中文

## 概述

`dsh-market-skills` 注册市场技能类型，通过 `ctx.marketSkills` 提供市场技能和个人技能，并将已安装的市场目录接入共享技能注册表。所有技能来源共用一个启用状态设置，个人技能可以从其所在文件夹删除。

## 目录

- [使用此包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

将此包与 `dsh-market`、技能注册表、settings 和 working-directory 服务一起挂载。使用 `marketSkills` Remote 列出已安装技能、读取技能文档、修改启用状态或删除个人技能。市场下载由市场的 `uninstallPackage` 删除。`uninstallPersonal` 从 `<DSH home>/skills` 或 `~/.agents/skills` 删除个人技能的目录或其 Markdown 文件；对链接进来的技能只删除链接，保留被链接的目录；其他来源的技能一律拒绝删除。

<a id="understand-the-implementation"></a>
## 实现说明

提供方监听市场类型目录和用户技能目录，解析当前 preset，并向共享注册表注册一个有作用域的提供方。管理 Remote 返回稳定的已安装视图，并在切换启用状态时写入共享 `disabled` 设置。

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

- 此包依赖 `dsh-market` 管理压缩包生命周期，并依赖共享 settings 服务保存启用状态。
- 停用的技能仍会安装并对管理调用方可见，但普通模型和用户读取会将其过滤掉。

### 开发备注

<a id="dev-note"></a>

无。

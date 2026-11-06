---
description: "挂载市场目录、技能安装和浏览器市场页面的 profile bundle。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-market-bundle

[English](README.md) | 中文

## 概述

此 bundle 为 profile 增加市场目录、已验证的技能安装、已安装技能开关、本机 MCP 连接器和浏览器市场页面。它是可选产品层，不存在时不会改变基础 profile。

## 目录

- [使用此包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

通过 profile 组合器将 bundle 加入 `dsh` profile。补丁会一起挂载 `dsh-market`、`dsh-market-skills`、`dsh-market-connectors` 和 `dsh-client-ui-market`，使 Host 与浏览器使用相同的目录和安装记录。

<a id="understand-the-implementation"></a>
## 实现说明

`cordis.patch.yml` 提供 Host 服务和浏览器插件。bundle 只负责组合；目录读取和压缩包验证由 `dsh-market` 负责，技能记录与启用状态由 `dsh-market-skills` 负责，连接器程序及其开关由 `dsh-market-connectors` 负责。

<a id="model-experience"></a>
## 模型体验

### 市场组合

#### 模型看到的内容

bundle 本身不提供内容。profile 同时包含技能发现和加载后，已安装技能会通过 `ctx.skills` 对模型可见；已连接的连接器通过 `ctx.tools` 加入它的 MCP 工具。

#### Token 影响

bundle 层没有影响。已安装技能消费者负责计算加载的指令正文；已连接连接器加入的工具 schema 见 `dsh-market-connectors`。

#### KV Cache 影响

没有直接影响。已安装技能内容由技能注册表及其模型消费者负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- bundle 需要可访问的目录 URL 和包含共享技能服务的 profile；它不提供目录服务器或备用软件包注册表。

### 开发备注

<a id="dev-note"></a>

无。

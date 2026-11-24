---
description: "为技能、连接器和插件挂载统一市场的 profile bundle。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-market-bundle

[English](README.md) | 中文

## 概述

此 bundle 提供包含技能、连接器和插件的统一市场页面，共享目录读取和已验证的软件包下载。它还提供已安装技能开关、本机 MCP 连接器和 profile 插件安装。它是可选产品层，不存在时不会改变基础 profile。

## 目录

- [使用此包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

通过 profile 组合器将 bundle 加入 `dsh` profile。补丁会挂载 `dsh-market`、`dsh-market-skills`、`dsh-market-connectors`、`dsh-market-plugins` 和 `dsh-client-ui-market`。通过 `market` 配置行的 `catalogUrl` 设置共享目录。插件适配器需要 profile 及其插件管理器。

<a id="understand-the-implementation"></a>
## 实现说明

`cordis.patch.yml` 提供 Host 服务和浏览器插件。bundle 只负责组合；目录读取、已验证的下载、操作进度和分发由 `dsh-market` 负责。各市场领域负责内容验证和运行时变更。插件适配器将依赖和 profile 变更交给插件管理器；插件的启用和配置仍可在插件页面管理。

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

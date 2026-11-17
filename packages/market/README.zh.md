---
description: "供技能、连接器和插件共享的市场目录与软件包操作。"
kind: "package-group"
---

# market/ - 市场能力

[English](README.md) | 中文

## 概述

`market/` 组提供可选市场 bundle 使用的目录和安装服务。核心包管理共享目录、已验证的下载和软件包操作。领域包将已安装内容接入技能注册表，启动已启用的 MCP 连接器，或通过插件管理器安装 profile 插件。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 作用 | ctx 键 |
|---|---|---|
| [`market`](market/README.zh.md) | 目录、软件包验证、安装和删除 | `ctx.market` |
| [`market-skills`](market-skills/README.zh.md) | 已安装技能提供方和管理 Remote | `ctx.marketSkills` |
| [`market-connectors`](market-connectors/README.zh.md) | 本机 MCP 连接器程序、开关及其技能 | `ctx.marketConnectors` |
| [`market-plugins`](market-plugins/README.zh.md) | 通过 profile 插件管理器安装市场插件 | `ctx.market` 注册 |

<a id="related-documentation"></a>
## 相关文档

- [技能子系统](../../docs/subsystems/skills.zh.md) - 生成的服务和类型参考。
- [市场 UI](../client/ui-market/README.zh.md) - 浏览器目录和已安装技能管理。
- [市场 bundle](../bundle/market/README.zh.md) - 挂载 Host 与浏览器包的 profile 补丁。

<a id="dev-note"></a>
### 开发备注

无。

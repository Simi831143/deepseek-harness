---
description: "市场目录、已验证的软件包安装和已安装技能管理。"
kind: "package-group"
---

# market/ - 市场能力

[English](README.md) | 中文

## 概述

`market/` 组提供可选市场 bundle 使用的目录和安装服务。核心包管理目录数据与已验证的压缩包，技能包将已安装内容接入共享技能注册表，并提供管理操作。

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

<a id="related-documentation"></a>
## 相关文档

- [技能子系统](../../docs/subsystems/skills.zh.md) - 生成的服务和类型参考。
- [市场 UI](../client/ui-market/README.zh.md) - 浏览器目录和已安装技能管理。
- [市场 bundle](../bundle/market/README.zh.md) - 挂载 Host 与浏览器包的 profile 补丁。

<a id="dev-note"></a>
### 开发备注

无。

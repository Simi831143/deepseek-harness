---
description: "Host 市场目录、已验证的压缩包安装和已安装项目记录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-market

[English](README.md) | 中文

## 概述

`dsh-market` 负责发布的市场目录、压缩包验证与解压、已安装项目记录以及 `ctx.market` Host 服务。领域包注册项目类型并负责其已安装内容的验证。

## 目录

- [使用此包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

使用目录 URL 和可写的 market home 挂载 `Market`。通过 `registerKind()` 注册支持的项目类型，再从 Host 消费者或类型化的 `market` Remote 命名空间调用 `catalogSnapshot()`、`installItem()` 和 `uninstallPackage()`。

<a id="understand-the-implementation"></a>
## 实现说明

服务通过 HTTP(S) 下载 JSON，将最近一次有效目录保存在磁盘上，验证软件包元数据和 SHA-256 内容，将文件解压到暂存目录后原子提升。已安装记录通过 storage-domain 服务保存，目录变化由 `watch()` 推送。

<a id="model-experience"></a>
## 模型体验

### 目录和安装服务

#### 模型看到的内容

没有直接内容。注册的领域可以通过自己的 `ctx.skills` 或工具消费者让已安装内容对模型可见。

#### Token 影响

没有直接影响；使用方领域负责计算加载的已安装内容。

#### KV Cache 影响

没有直接影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 目录 URL 由部署配置，服务不负责为目录签名或提供镜像。
- 软件包安装仅支持已注册的项目类型及其验证器。

### 开发备注

<a id="dev-note"></a>

无。

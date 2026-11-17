---
description: "Host 市场目录、已验证的压缩包安装和已安装项目记录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-market

[English](README.md) | 中文

## 概述

通过同一个目录浏览专家、技能、连接器和插件，并通过 `market` Remote 命名空间安装或卸载。每类资源提供自己的内容验证与运行时接入。

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

服务通过 HTTP(S) 读取同一个 JSON 目录，包括其中发布的插件版本，并保留最近有效的目录供浏览。每次安装都会带 ETag 重新验证目录；读取失败以 `market/catalog-unavailable` 停止安装。已删除的条目或指定版本会被拒绝，下载的安装包必须同时通过大小与 SHA-256 校验。下载过的压缩包不会被复用于另一次安装。

压缩包类型先验证暂存目录再替换已安装文件，安装记录由市场管理。托管类型接收同一套下载流程验证后的包数据，提供自己的安装、卸载和真实安装状态。[插件适配器](../market-plugins/README.zh.md) 将 profile 依赖与运行时变更交给插件管理器。`watch()` 通过同一个快照推送所有类型的状态，以及下载、解压和软件包安装进度。托管操作无论成功还是失败都会刷新安装状态，已经完成的依赖删除不会被显示为已经回滚。

压缩包更新会在安装返回后删除旧副本；下次启动会完成中断的暂存清理。压缩包卸载先撤销运行时贡献，再删除安装目录。插件压缩包的保留与删除遵循[插件管理器清理规则](../../boot/plugin-manager/README.zh.md#failure-behavior)。

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
- 安装仅支持已注册的类型。统一插件市场接受已发布的 tarball；npm 和 Git 安装仍由插件管理器提供。

### 开发备注

<a id="dev-note"></a>

无。

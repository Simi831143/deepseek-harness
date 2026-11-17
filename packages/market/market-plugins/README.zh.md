---
description: "通过统一市场安装和移除 profile 插件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-market-plugins

[English](README.md) | 中文

## 概述

通过技能和连接器共用的市场安装、更新和卸载已发布插件。插件管理器负责 profile 依赖和运行状态；市场提供目录、经过校验的下载、操作进度和浏览器结果。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制和后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

将此插件与 `dsh-market` 及当前 profile 的 `dsh-plugin-manager` 一起挂载。[市场组合包](../../bundle/market/README.zh.md) 提供该组合。插件请求使用市场现有的 `installPackage` 和 `uninstallPackage` 操作，传入 `kind: 'plugin'`，以 npm 包名作为 `id`。可选的精确 `version` 用于选择已发布版本。

市场先校验下载的大小和 SHA-256，再由此插件读取清单。清单必须声明所选包名、版本和组合包。`manifestMaxBytes` 将清单的解压后大小限制为默认 1 MiB。所选版本必须满足 DSH 兼容要求，或已有对应精确版本的豁免。此处不能替换或移除应用提供的插件。

更新先移除旧依赖，再安装新版本，并保留其启用选择。需要重启 Host 的安装在市场状态中返回 `restartRequired`。如果移除成功而替换失败，依赖保持未安装状态；重试前请检查插件页面。未启用 HMR 的 profile 无法移除正在被 Host 使用的插件。

<a id="understand-the-implementation"></a>
## 理解实现

此插件向[市场服务](../market/README.zh.md) 注册一种托管类型。安装状态来自插件管理器，不另存一份市场安装记录。校验后的 tgz 保存在 `<profile>/.plugin-market/tarballs` 下的唯一路径中，因为 pnpm 会将本地文件记录为依赖来源。只要任意 profile 依赖仍引用该文件，就保留它；成功移除使用[插件管理器的清理逻辑](../../boot/plugin-manager/README.zh.md#failure-behavior)。准备失败时删除未被引用的新文件；激活失败但依赖仍保留时，也保留对应来源文件。取消操作等待管理器持有的安装任务结束。管理器变化会刷新统一市场的数据流。卸载此插件时会拒绝新操作、取消正在进行的安装，并等待已接受的操作和刷新结束后再撤销类型注册；已经提交的移除结果保持生效。

<a id="model-experience"></a>
## 模型体验

### 插件安装

#### 模型看到什么

不直接提供模型可见内容。现有 `plugin_manager` 调用方继续负责各自的授权和展示。

#### Token 影响

无直接影响；已安装插件自行负责其贡献的工具和提示词。

#### KV Cache 影响

无直接影响。

## 已知限制和后续工作

<a id="known-limitations-and-deferred-work"></a>

- 此市场流程安装已发布的 tgz。索引中的 npm 和 Git 版本仍可展示，但无法通过该经过校验的压缩包流程安装。
- 插件管理器开始移除后无法中断。调用方取消时，已提交的结果仍然有效。
- 包构建脚本审批仍由插件管理器负责；被阻止的安装会报告失败，不会自动授予脚本权限。

### 开发备注

<a id="dev-note"></a>

无。

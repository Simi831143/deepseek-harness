---
description: "用于浏览、安装、切换和删除市场技能的浏览器市场页面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-market

[English](README.md) | 中文

## 概述

市场客户端插件在浏览器页面展示目录技能，跟踪 Host 的安装状态，并允许用户安装、启用、停用、编辑或删除市场技能和个人技能。它挂载所使用的 `market` 与 `marketSkills` Remote 命名空间，并通过 `session` 命名空间在文件管理器中显示技能文件夹。

## 目录

- [使用此包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

将插件与 Web 客户端和 Host 市场 bundle 一起挂载。打开市场面板即可浏览技能分类、查看技能详情、安装技能并管理已安装列表。安装、切换或删除后页面会刷新技能名称和斜杠菜单候选项。

每个已安装技能的详情弹窗都有同一个“更多操作”菜单，无论技能来自市场还是个人文件夹：

- **编辑**：打开新对话，输入框内容为 `/skill-creator 请帮我编辑 /<skill> 这个 skill`，两个名称都是技能引用，不会自动发送。
- **打开文件夹**：在 Host 的文件管理器中选中技能的说明文件。只有 Host 报告有桌面且技能有文件路径时才显示。
- **卸载**：先确认。市场技能通过市场卸载；个人技能会删除其文件夹。

<a id="understand-the-implementation"></a>
## 实现说明

客户端使用一个可观察 store 保存目录和已安装技能流。用户操作调用类型化 Remote 方法，并通过页面和持久 toast 展示成功或失败。插件提供主面板、导航入口，以及 `ui-skill` 使用的技能显示名称。

<a id="model-experience"></a>
## 模型体验

### 已安装技能发现

#### 模型看到的内容

页面不增加提示词。启用技能会改变 `ctx.skills`，因此已有技能目录可以根据调用策略向模型展示它。

#### Token 影响

浏览页面时没有影响。之后调用技能时，现有技能消费者负责计算指令正文。

#### KV Cache 影响

没有直接影响；面向模型的技能内容由 Host 技能消费者负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 页面需要 Host 提供市场 Remote 命名空间；目录端点离线时会显示最近一次可用的目录。
- 在页面上删除个人技能后无法撤销；文件会被直接删除，不会进入回收站。
- 编辑依赖 `skill-creator` 技能；组合中没有它时，引用会作为普通文本发送。

### 开发备注

<a id="dev-note"></a>

无。

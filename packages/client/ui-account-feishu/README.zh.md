---
description: "飞书账号侧边栏入口和设置页：扫码登录、身份展示、切换账号和退出登录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-account-feishu

[English](README.md) | 中文

## 概述

飞书账号界面在侧边栏账号入口和设置的**账号**页显示已登录用户的头像和名称。用户可以在任一处扫飞书二维码登录、切换到另一个飞书账号或退出登录。账号只用于标明用户：模型在「模型」页使用各自的 API Key，退出登录不会影响它们。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

通过 `@deepseek-ai/dsh-account-feishu` 加载本包；它是 Client 插件，不是独立应用入口。该 bundle 提供飞书 provider 行，并在这些组件注册前关闭上游账号界面。

未登录时，侧边栏入口提供**设置**和**飞书扫码登录**。已登录时显示头像和名称，并提供**设置**、**切换账号**和**退出登录**。桌面端在独立的登录窗口中打开飞书扫码页；等待中的登录尝试在设置页还提供打开链接、复制链接和取消操作。切换账号时，新登录提交前仍保留当前账号，取消切换不会改变任何状态。退出登录前会确认。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者的工作上下文——点击展开</summary>

每个客户端一个 store：跟随共享 `account` Remote 流，每个已存 grant 读取一次资料，登录完成后再读一次，并提供登录、取消和退出操作。`settings.launcher` 与 `settings.section` 两处注册注入同一个 store，所以两个界面显示同一份状态。直接提供的 Web 应用把页面 origin 作为 OAuth 回调 origin。桌面端从 `dsh-app:` scheme 加载页面，所以 store 改用 shell 通过 `__DSH_TRANSPORT__.streamBaseUrl` 发布的 Host 回环 origin，并把登录来源标为 `desktop`。在发布任何授权地址之前出现的 `protocol` 失败表示当前构建没有飞书应用密钥，界面会直接说明，而不是让用户重试。Host 面导出空的 `apply`，让 Loader 挂载这一行，客户端模块系统再提供它的浏览器半部分。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 由 Loader 挂载的 Host 面 |
| [`src/client/index.ts`](src/client/index.ts) | Client 插件、账号流和 slot 注册 |
| [`src/client/account-store.ts`](src/client/account-store.ts) | 账号状态、资料读取、回调 origin 和操作 |
| [`src/client/FeishuAccountMenu.tsx`](src/client/FeishuAccountMenu.tsx) | 侧边栏入口及其菜单 |
| [`src/client/FeishuAccountSection.tsx`](src/client/FeishuAccountSection.tsx) | 设置账号页 |
| [`src/client/attempt-status.tsx`](src/client/attempt-status.tsx) | 共用的登录进度提示、链接兜底和失败文案 |
| [`src/client/locales.ts`](src/client/locales.ts) | 中英文文案 |
| [`tsdown.config.ts`](tsdown.config.ts) | Client bundle 入口配置 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [account-feishu bundle](../../bundle/account-feishu/README.zh.md) —— profile 补丁和包组合。
- [feishu-account](../../credentials/feishu-account/README.zh.md) —— Host OAuth 与凭据行为。
- [Settings slots](../../../docs/subsystems/slots.zh.md) —— 入口和设置页使用的 slot 生命周期。

-----

<a id="model-experience"></a>
## 模型体验

### 仅账号界面

#### 模型看到什么

无。本包只改变用户可见的账号界面，不增加提示词、工具、模型输入或 `Session` 事件。

#### Token 影响

无。本界面既不读取也不提供模型凭据。

#### KV Cache 影响

无；本包不参与模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **Web 端授权页由浏览器控制。** 直接提供的 Web 应用把授权页交给浏览器；浏览器已登录飞书网页版时显示授权按钮，而不是二维码。
- **界面依赖共享 account Remote。** 没有 account Remote 时，注册无法解析所需服务。
- **不发布运行时不变量伴生包。** 界面不拥有持久关系；它观察的状态由 provider 和 slot registry 所有。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

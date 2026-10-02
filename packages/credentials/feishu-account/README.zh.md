---
description: "支持 PKCE、刷新和持久化账号身份的 Host 飞书 OAuth 提供方。"
kind: "package-reference"
---

# @deepseek-ai/dsh-feishu-account

[English](README.md) | 中文

## 概述

这个仅 Host 提供方用飞书 OAuth 和 PKCE 实现共享账号契约。它通过 credentials 服务存储飞书 `union_id`、`open_id`、展示字段和刷新 grant，并从命名的 Host 环境变量读取应用密钥。

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

使用 `@deepseek-ai/dsh-account-feishu` 提供的 `feishu-account` 行。配置 `appId`、`appSecretRef` 和 `scope`；默认密钥引用是 `FEISHU_APP_SECRET`。提供方只在显式登录尝试期间启动 loopback 回调监听。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者的工作上下文——点击展开</summary>

提供方校验回调 origin，使用 PKCE 完成授权码交换，读取用户信息，并保存刷新 token 轮换结果。已存 grant 时发起的新登录就是切换账号：新 grant 提交前保留现有 grant，取消或失败的尝试不会改动它。剩余时间少于五分钟时刷新 grant，合并进程内并发刷新，并在删除过期 grant 前再次检查存储的 token。Host 服务销毁时会清理回调和登录尝试生命周期。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 账号服务、回调生命周期、grant 持久化和刷新行为 |
| [`src/protocol.ts`](src/protocol.ts) | 飞书 HTTP schema、端点调用、超时和错误映射 |
| [`src/types.ts`](src/types.ts) | 提供方配置类型 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [account-feishu bundle](../../bundle/account-feishu/README.zh.md) —— 挂载此提供方的 profile 行。
- [authorization](../authorization/README.zh.md) —— 共享浏览器授权生命周期。
- [deepseek-account](../deepseek-account/README.zh.md) —— 本提供方实现的账号契约。

-----

<a id="model-experience"></a>
## 模型体验

### 仅账号身份

#### 模型看到什么

无。`resolveToken()` 按设计返回空值；本提供方只提供账号身份和登录状态。

#### Token 影响

无。飞书 access grant 和 refresh grant 只认证账号流程，不用于模型推理。

#### KV Cache 影响

无；本提供方不组装模型提示词或推理请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **grant 过期或应用身份变化后需要重新授权。** 提供方会删除过期或不匹配的 grant，而不是静默接受它。
- **缺少部署密钥时，登录在打开授权页之前失败。** 这次尝试以 `protocol` 失败，且不发布授权地址，这样就不会有用户扫一个换不到 token 的二维码；Host 会在日志里记下缺少的引用名。Host 仍可启动，以便账号界面报告配置问题。
- **登录时需要共享 Host web server。** 活跃授权尝试之外不会单独打开回调监听。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

---
description: "邮箱一次性验证码登录：发证方后端实现的接缝，以及本次构建随包提供的 cam-auto-platform 后端。"
kind: "package-reference"
---

# @deepseek-ai/dsh-email-code-account

[English](README.md) | 中文

本包承载邮箱一次性验证码登录的**后端接缝**。接缝之上（账号 provider、凭据存储、登录表单）与发证方无关；接缝之下是某一家公司的 HTTP 形状。更换发证方 = 再实现一次 `EmailCodeBackend`，并把装配指向那份实现。

`requestCode` 请求发证方向某个地址寄出验证码，在发证方**接受请求**后返回（不是等邮件送达）。`verifyCode` 用用户读到的验证码换取凭据及凭据所属的身份。两者都接收调用方的 `AbortSignal`，因此重试策略由调用方掌握，也不会有定时器活过它所属的调用。

`EmailCodeError.kind` 区分调用方可以据以行动的情形：`network` 表示发证方不可达或已过截止时间，`rejected` 表示发证方已答复并拒绝，`invalid-response` 表示答复无法使用。provider 会把它们映射成账号层的登录错误码；发证方的原文不会逐字进入界面。

## Summary

通过可替换的发证方后端，用邮箱一次性验证码登录。账号 provider 与登录表单只依赖那条接缝。

随包提供的 `createCamAutoPlatformBackend` 调用平台的 `/users/send-verification-code` 与 `/users/verify-code-login`，并从平台统一的 `{ code, success, data, message, errors }` 信封内部判定失败——在那套协议里，仅凭 2xx 并不代表成功。

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

为部署配置 `baseUrl` 与 `requestTimeoutMs`，再把后端交给账号 provider。基地址是不带结尾斜杠的 origin；后端会归一化结尾斜杠，因此 `http://host:8081/` 与 `http://host:8081` 指向同一组端点。

平台的登录类型固定为 2（登录），它在地址未知时也会建号——那是发证方自身的行为，因此本包不需要额外的注册步骤。

`verifyCode` 会读取返回 token 的 claims，以还原展示用的身份与过期时间。它**不校验签名**：只有发证方才有资格校验自己的 token，而 claims 进入凭据快照是为展示，从不作为授权凭据。

<a id="understand-the-implementation"></a>
## Understand the implementation

接缝只有两个方法、一个结果类型、一个错误类，所以接入第二家发证方的代价是一个文件加一个配置值。provider 通过 `EmailCodeBackend` 组合本包，从不直接 import cam-auto-platform 后端——这正是"可替换"得以成立的原因。

<a id="further-exploration"></a>
## Further Exploration

凭据存储由[凭据子系统](../../../docs/subsystems/credentials.zh.md)负责；应用装配见[架构文档](../../../docs/architecture.zh.md)。

<a id="model-experience"></a>
## Model Experience

无。本包返回的凭据会交给账号层用于展示，从不发送给模型。

#### KV Cache effect

模型请求前缀不变。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 随包后端只针对一个部署、只读一种响应信封。若第二家发证方改动其中任何一项，那是新增文件，而不是改配置。
- 平台把所有拒绝合并为一条消息，因此 `rejected` 不携带更细的原因；调用方无法区分"码错"与"码已过期"。
- token 没有刷新流程：过期时间取自 token 自身的 claim，之后不会被续期。
- **运行时不变量：** 不发布运行时不变量伴随包，因为本包不持有可变的运行时状态；它产出的凭据写入凭据存储，其结构由宿主在每次读取时校验。

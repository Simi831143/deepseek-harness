---
description: "dsh Web 客户端设置页上的邮箱验证码登录卡片。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-account-email

[English](README.md) | 中文

## Summary

在侧边栏打开**设置**，选择**邮箱登录**，即可用发送到邮箱的一次性验证码登录。卡片收集邮箱、请宿主让签发方发送验证码、把重发按钮按住一分钟、用验证码换取已存储的登录，随后显示这次登录所证明的身份，并提供**退出登录**。所有失败只有一种说法：卡片不会透露邮箱是否存在、验证码是否过期、或签发方是否不可达。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

填写邮箱后点击**发送验证码**；在字段内容还不足以投递之前，该按钮不可用。签发方接受请求后，按钮变为倒计时（`60 秒后可重发`），一分钟结束时自行恢复。填写邮件中的验证码并点击**登录**：宿主保存登录，卡片切换为身份行——签发方给出的姓名，若未给出则显示邮箱——以及**退出登录**。退出登录只删除本地已保存的登录；签发方没有吊销接口，磁盘上不会删除其他内容。

## Understand the implementation

<details>
<summary>实现细节 —— 点击展开</summary>

宿主半是空的 `apply`，仅为让该包在 Loader 中占一行，客户端模块系统据此把浏览器半交给浏览器。浏览器半绑定自己的 `settings.accountEmail` 词典，并把 `EmailLoginCard` 注册进 `settings.section` 列表插槽，`id: 'email-login'`、`order: -9`，从而占据浏览器往返流程那张卡片让出的位置。

交互由卡片自己驱动；账号契约的 attempt 状态机并不描述"输入验证码"这一步，因此 `attempt` 恒为 `null`，卡片通过 `ctx.remote.emailLogin` 自行驱动这两步。它观察共享的 `account` 命名空间而不自建会话：`ctx.remote.account.watch` 报告是否已存凭据，`getProfile` 提供宿主已经证明过的展示身份——登录之后不会再有任何面向签发方的请求。退出登录走 `ctx.remote.account.signOut`，与原先那张浏览器往返卡片用的是同一道缝。

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings](../ui-settings/README.zh.md) —— 设置外壳，以及卡片注册进去的 `settings.section` 列表插槽。
- [email-code-account](../../credentials/email-code-account/README.zh.md) —— 提供方、`emailLogin` Remote 命名空间，以及卡片调用的签发方适配器。
- [account-email](../../bundle/account-email/README.zh.md) —— 关掉浏览器往返行、并挂载本卡片的 bundle。
- [ui-primitives](../ui-primitives/README.zh.md) —— 卡片渲染所用的按钮与输入原子组件。

-----

<a id="model-experience"></a>
## Model Experience

无：该包是浏览器侧设置界面，不注册任何模型界面。

#### KV Cache effect

无；该包既不组装也不发送模型请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **退出登录是本地行为。** 签发方没有吊销接口，因此退出登录只删除本地已存的凭据；已被复制出去的令牌在过期前仍然有效。
- **只有一条失败文案。** 所有拒绝都以同一句话呈现，运维排查部署问题需要看宿主日志而非页面。
- **运行时不变量：** 不发布伴随包。卡片不持有自己的存储：它显示的内容来自账号流与资料读取，它发送的内容由宿主校验。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

无。

</details>

---
description: "用邮箱验证码登录替换浏览器往返式账号登录。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-account-email

[English](README.md) | 中文

## Summary

本 bundle 关掉实现浏览器往返式账号登录的两行——`deepseek-account` 与 `ui-settings-account`——并插入替代它们的三行：以已存储的邮箱凭据应答同一份账号契约的提供方、持有登录两步的 Remote 控制器、以及驱动它们的设置卡片。被关掉那张卡片的余额与充值入口一并消失是预期行为：本部署没有钱包。

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

打开**设置**，选择**邮箱登录**。邮箱字段、验证码字段、重发倒计时与已存身份的表现与 [`ui-account-email`](../../client/ui-account-email/README.zh.md) 所述一致。被本 bundle 关掉的那些行在面板里不留痕迹：浏览器往返卡片、它的侧边栏入口与引导界面是彻底缺席，而不是就地置灰。由于本 bundle 从一开始就在 profile 的分层列表里，不需要运维手动选择。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>维护者细节 —— 点击展开</summary>

`cordis.patch.yml` 按 id 关掉两行上游条目，并插入自己的三行，因此组合出的 profile 发生变化而任何上游文件都不变：`id` + `disabled` 是修改别的层已经贡献的条目，而新增条目必须写在 `insert` 里——用一个尚不存在的 id 直接写裸 `id` 会被静默忽略。分层顺序是其前提：base bundle 贡献了 `deepseek-account`，Web bundle 贡献了 `ui-settings-account`，两者都在本层之前打补丁。

`package.json` 依赖它各行所指向的两个包，使每行都能从本 bundle 解析；`apps/cli` 依赖本 bundle，使其进入安装包的运行时闭包。`apps/desktop/src/project-manager.ts` 把它列进桌面 profile 的 bundle 分层列表。

| 文件 | 作用 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 关掉 `deepseek-account` 与 `ui-settings-account`；插入 `email-code-account`、`email-login-controller`、`ui-account-email` |
| [`package.json`](package.json) | 各行所指向的包作为依赖，以及 profile 分层声明 |
| [`locale/en.json`](locale/en.json)、[`locale/zh.json`](locale/zh.json) | 插件管理器的标题与描述 |
| [`icon.svg`](icon.svg) | 插件管理器图标 |
| [`src/index.ts`](src/index.ts) | 空模块入口；补丁才是运行时内容 |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [email-code-account](../../credentials/email-code-account/README.zh.md) —— 提供方、签发方适配器，以及卡片调用的 `emailLogin` Remote 命名空间。
- [ui-account-email](../../client/ui-account-email/README.zh.md) —— 本 bundle 挂载的设置卡片。
- [base bundle](../base/README.zh.md) —— 贡献 `deepseek-account` 的那一层。
- [web bundle](../web-app/README.zh.md) —— 贡献 `ui-settings-account` 的那一层。

-----

<a id="model-experience"></a>
## Model Experience

无：本 bundle 替换的是登录界面，模型路径不受影响：该提供方不解析任何推理凭据，因此 `llm-deepseek` 及其密钥仍按原样服务请求。

#### KV Cache effect

无；该包既不组装也不发送模型请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **登录时签发方必须可达。** 只有登录这一步会与它通信；此后的每次读取都由已存凭据提供。
- **按 id 关闭条目依赖顺序。** 被关掉的两行在本层生效时必须已经存在。若某个 profile 选中本 bundle 却没有 base 或 Web bundle，每行缺失都会记一条 `patch: entry <id> not found`，浏览器往返卡片仍会保留。
- **运行时不变量：** 不发布伴随包，因为本 bundle 不持有可变的运行时状态；它的全部内容就是两条补丁和三个插入行。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者细节 —— 点击展开</summary>

无。

</details>

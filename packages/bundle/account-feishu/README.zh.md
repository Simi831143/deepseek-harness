---
description: "用飞书 OAuth 登录替换浏览器往返式账号登录。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-account-feishu

[English](README.md) | 中文

## 概述

本 bundle 用只标明用户身份的飞书账号替换 DeepSeek 平台账号。它关闭平台账号提供方、平台账号界面和账号 token 模型路由，再插入飞书 OAuth 提供方和飞书账号界面。模型使用各自的 API Key，所以无论是否登录，新安装都能使用内置的默认模型。提供方使用飞书 `union_id` 作为账号身份，并把应用密钥保存在 Host 环境中，而不是 profile 中。

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

在侧边栏账号入口或设置的**账号**页扫飞书二维码登录；同样的位置也可以切换账号和退出登录。桌面部署从部署环境提供 `FEISHU_APP_SECRET` 和 `LONGCHEER_API_KEY`；两个值都不会写入 profile。Web 部署需要在启动 profile 前为 Host 进程提供这两个变量。base 组合仍将 `longcheer/qwen3.8-plus` 作为默认模型。

Windows 打包时，将两个值写入仓库根目录 `.secrets.env`，设置 Electron 镜像后执行 `pnpm run package:desktop:win:x64:unsigned`。打包器只会将这两个名称写入 `deployment-env.json`，Desktop 主进程每次启动时再注入 Host。

桌面回调地址是 `http://127.0.0.1:19387/feishu/callback`。Web 使用客户端传入的 loopback origin。桌面端在应用内窗口打开授权页，每次登录尝试都使用全新的浏览器会话，所以飞书总是显示二维码登录，切换账号也能换到另一个账号。登录等待期间，设置页保留复制链接和打开链接两种兜底方式。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者的工作上下文——点击展开</summary>

`cordis.patch.yml` 关闭 `deepseek-account`、`ui-settings-account` 与 `llm-deepseek-account`，再插入 `feishu-account` 与 `ui-account-feishu`。若不关闭该模型路由，模型列表会出现一个飞书账号永远无法认证的「DeepSeek Account」提供方。`package.json` 声明两个插入包，使这些行能从本 bundle 解析；应用 profile 把本 bundle 选作最后一层。

提供方使用 PKCE，请求 `offline_access contact:user.email:readonly`，在 token 过期前刷新，并通过 credentials 服务持久化账号身份和刷新凭据。提供方不返回模型 token、钱包链接、余额或平台会话。

| 文件 | 作用 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 关闭上游账号行和账号模型行，并插入飞书行 |
| [`package.json`](package.json) | 声明 bundle 补丁和其中的行包 |
| [`src/index.ts`](src/index.ts) | 空模块入口；运行时内容在补丁中 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [feishu-account](../../credentials/feishu-account/README.zh.md) —— OAuth 提供方和已存 grant 的行为。
- [ui-account-feishu](../../client/ui-account-feishu/README.zh.md) —— 侧边栏入口、设置页和登录交互。
- [base bundle](../base/README.zh.md) —— 贡献 `deepseek-account` 的那一层。
- [web bundle](../web-app/README.zh.md) —— 贡献 `ui-settings-account` 的那一层。

-----

<a id="model-experience"></a>
## 模型体验

### 仅账号组合

#### 模型看到什么

无。本 bundle 替换账号登录，不增加提示词、工具、模型输入或 `Session` 事件。

#### Token 影响

无。本 bundle 不签发或解析推理凭据。

#### KV Cache 影响

无；本包既不组装也不发送模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **登录时必须能访问飞书签发方。** 已有会话在需要刷新前使用已存 grant。
- **部署密钥仍属于部署配置。** 缺少 `FEISHU_APP_SECRET` 时，登录会在显示二维码前失败，账号界面提示当前版本无法登录；缺少 `LONGCHEER_API_KEY` 会使默认 Longcheer 模型请求失败。Host 仍会启动，两个密钥都不会复制到 profile `.env`。
- **提供方不是模型凭据提供方。** `resolveToken()` 按设计返回空值。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

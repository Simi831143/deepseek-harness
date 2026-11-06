---
description: "市场连接器类型和自定义连接器：按连接器分别启动和停止的 MCP 程序和服务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-market-connectors

[English](README.md) | 中文

## 概述

`dsh-market-connectors` 注册市场连接器类型，并通过 `ctx.marketConnectors` 提供连接器。市场连接器是一个本机 MCP 程序，市场安装包里同时带着它的运行环境。自定义连接器是用户粘贴 JSON 或手动填写添加的 MCP 服务：可以是在 PATH 里找到的本机程序，也可以是远程 Streamable HTTP 服务。开启的连接器（市场连接器还要接受过）作为一个 mcp-client 实例对所有 Agent 运行；关闭就会停止它。

## 目录

- [使用此包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

将此包与 `dsh-market`、storage domain、技能注册表和工具注册表一起挂载。先通过市场的 `installPackage` 安装连接器，再调用 `marketConnectors` Remote 的 `setConnectorEnabled`。已安装连接器第一次开启时必须传 `confirmed: true`，表示用户接受了这个程序；之后再开关不需要重新接受，直到连接器被卸载。`retryConnector` 重新启动首次启动失败的连接器，`watch` 推送每一次状态变化。每个结果都带 `revision`，每次变化加一，Host 重启后从头计数，客户端据此丢弃比 `watch` 新帧晚到的调用结果。

连接器安装包的根目录有一个 `mcp.json`：

```json
{ "command": "python/python.exe", "args": ["-I", "-B", "${dir}/server.py"], "env": {}, "toolCallTimeoutMs": 60000 }
```

`command` 必须是安装包内的文件；绝对路径和靠 PATH 查找的名字都会被拒绝。`args` 和 `env` 中的 `${dir}` 会展开为安装包目录，其它占位符一律不接受。Python 解释器必须用 `-I` 启动。程序的工作目录是安装包目录。`parseLaunchManifest` 和 `readLaunchManifest` 执行这些规则，Desktop 的内置连接器也可以直接使用。市场连接器的 id 不能以 `custom-` 开头。

安装包还可以带一个 `settings.json`，声明需要用户填写的值，例如 API key。它放在 `mcp.json` 旁边，因为旧版本会拒绝 `mcp.json` 里不认识的字段，但会忽略不认识的文件：

```json
{ "settings": [{ "env": "CONTEXT7_API_KEY", "label": { "zh": "API key" }, "secret": true, "required": false, "url": "https://context7.com/dashboard" }] }
```

每个设置项写明程序读取的环境变量名，不能和 `mcp.json` 已设置的重复。`secret` 默认 `true`，`required` 默认 `false`；最多 8 项。连接器视图在 `settings` 里列出它们和 `configured`，从不返回值。`saveConnectorSettings({ id, values })` 保存去掉首尾空白后 1 到 4096 个字符的值，`null` 清除一项，没写到的项保持原值；正在运行的连接器会用新值重启。已开启但必填项没有值的连接器不会启动，视图里报 `hint: 'setting-required'`。`parseConnectorSettings` 和 `readConnectorSettings` 执行这些规则。

自定义连接器不需要市场安装包，也不需要接受确认。`parseCustomConnectors({ text })` 解析粘贴的 JSON，不保存：接受 `mcpServers` 格式、VS Code 的 `servers`、只剩各个服务的对象、单个服务，以及去掉外层花括号的片段，允许注释和末尾逗号。每个服务返回将要保存的配置，或者 `sse`、`name-taken` 这类 `problem` 代码。`saveCustomConnector({ config, previousName?, enabled? })` 新增或修改一个，`removeCustomConnector({ name })` 停止并删除它。名称只能用英文字母、数字、`-` 和 `_`，最长 25 个字符，重名检查不区分大小写；连接器的 id 和 mcp-client 的 `serverName` 是 `custom-<名称>`。`setConnectorEnabled` 和 `retryConnector` 使用这个 id。

```json
{ "name": "time", "transport": "stdio", "command": "uvx", "args": ["mcp-server-time"], "env": {} }
```

自定义的本机程序用的是用户自己的运行环境。命令在 Host 的 PATH 里查找，Windows 上写 `npx` 会找到 `npx.cmd`；工作目录默认是用户主目录。环境变量是 Host 去掉凭据后的环境再加上 `env`，所以 `GITHUB_TOKEN` 这类 token 要填在 `env` 里。远程服务每次请求都带上固定的 `headers`。

启动失败时，连接器的视图里带着失败原因、常见原因的 `hint`（`command-not-found`、`cwd-not-found`、`start-timeout`、`unauthorized`、`maybe-sse`、`unreachable`、`setting-required`），本机程序还带着它最后写到 `stderr` 的几行。市场连接器也一样。

<a id="understand-the-implementation"></a>
## 实现说明

开关和接受记录保存在 `market_connectors` storage domain 中。自定义连接器的配置，包括环境变量和 Headers 的值，以明文保存在 `market_custom_connectors` domain 中。每次市场同步、连接器开关、重试和自定义连接器的改动，都会把正在运行的程序和服务对齐到“已开启的自定义连接器”和“已安装、已开启、已接受且清单有效的市场连接器”。安装包摘要或自定义配置、以及解析后的启动参数都没变的，会继续运行，所以每次读取目录后的同步不会重启任何程序；修改自定义连接器会重启它，改名会停掉旧的、启动新的。自定义的本机程序启动前，先检查工作目录和命令是否存在：在 Windows 上，cross-spawn 会把找不到的命令交给 `cmd.exe`，SDK 只会报连接已关闭。安装要替换某个连接器的目录之前，市场会调用此包的 `release` 停止该程序；安装之后的同步再启动新版本。卸载时先删除记录并同步，然后市场才删除文件。连接器安装包里的 `SKILL.md` 由 `market-connector` 技能提供方提供，只在该连接器已连接时可见。

设置的值保存在凭据存储里，每个连接器一条 `api-key` 记录 `market-connectors/<id>`，其 `env` 存放已保存的值；安装包里不存值，所以更新后值仍在，卸载时删除这条记录。每次对齐都读取这条记录，只把声明过的变量名加进程序的环境，放在 `mcp.json` 的 `env` 之后。重启指纹里放的是这些值的 SHA-256 摘要，不放值本身。这类记录的 `credentials/record-updated` 事件（包括直接编辑凭据文件）会触发重新对齐。读不出记录时，连接器报告原因，不会在缺少值的情况下启动。

<a id="model-experience"></a>
## 模型体验

### 已连接连接器的工具

#### 模型看到的内容

每个已连接的连接器通过 `dsh-mcp-client` 加入它的 MCP 工具（`mcp__<连接器 id>__<工具>`），以及服务器说明对应的系统提示段 `mcp:<连接器 id>`。连接器已连接时，它的 `SKILL.md` 出现在技能目录中。已连接的市场连接器声明了设置项时，下面的 `market-connectors:settings` 系统提示段会把每个声明的变量列为 `saved` 或 `not saved`，从不写出值，每个这样的连接器占一行。

##### 市场连接器设置段

```markdown
Market connector settings. The user saves these values in the connector's detail dialog: 市场 → 连接器 → the connector → 设置. Desktop keeps them in its credential store and restarts the connector with them.
When a tool result shows a missing, wrong or rate-limited key, tell the user to open that dialog. Do not ask for the value in the conversation; if the user pastes one, ask them to save it in the dialog instead and suggest replacing the pasted key. Do not edit the connector's mcp.json or set environment variables: an update replaces the files, and Desktop does not pass environment variables named like keys or tokens to connectors.
- context7: CONTEXT7_API_KEY saved
```

#### Token 影响

每个已连接的连接器都会在每次请求中带上完整的工具 schema 和说明，直到它被关闭。设置段约 150 个 token，每个声明了设置的已连接连接器再加一行；没有这样的连接器时不占 token。

#### KV Cache 影响

连接或断开会改变工具列表和系统提示，下一次请求的提示缓存会失效一次。保存或清除设置会改变设置段并重启连接器，同样失效一次。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 连接器以用户本人的权限运行，不在沙箱内，工具调用遵循 profile 对 MCP 工具的策略。目录里的安装包只校验 SHA-256，目录本身没有签名。
- 因关闭、更新或卸载而停止连接器时，它正在处理的工具调用会中断。
- `connected` 只反映首次启动的结果；之后断线只会表现为工具调用失败，同时 mcp-client 自动重连。
- 市场连接器都是 stdio 程序。自定义连接器可以是带固定 Headers 的远程 Streamable HTTP 服务；不支持 OAuth 和 SSE 服务。
- 自定义连接器的环境变量和 Headers 的值和配置一起明文保存，并返回给页面。
- 市场连接器设置的值只受凭据存储本身的保护：本地存储把它们放在只有当前用户账号能读的文件里，agent 自己的工具进程也能读到。
- Host 运行期间安装的运行环境（例如 Node.js、uv）要等 Host 重启后才能找到，因为 Host 沿用启动时的 PATH。

### 开发备注

<a id="dev-note"></a>

无。

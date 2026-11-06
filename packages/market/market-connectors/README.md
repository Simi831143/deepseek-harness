---
description: "Market connector kind and custom connectors: MCP programs and services started and stopped per connector."
kind: "package-reference"
---

# @deepseek-ai/dsh-market-connectors

English | [中文](README.zh.md)

## Summary

`dsh-market-connectors` registers the market connector kind and exposes connectors through `ctx.marketConnectors`. A market connector is a local MCP program that its market package carries with its runtime. A custom connector is an MCP server the user adds by pasting JSON or filling in a form: a local program found on PATH, or a remote Streamable HTTP service. A connector that is switched on (and, for a market connector, accepted) runs as one mcp-client instance for every Agent, and switching it off stops it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this package beside `dsh-market`, the storage domain, the skill registry, and the tool registry. Install a connector through the market's `installPackage`, then call `setConnectorEnabled` on the `marketConnectors` Remote. The first switch-on of an installed connector must pass `confirmed: true`, which records that the user accepted the program; later switches need no acceptance until the connector is uninstalled. `retryConnector` starts a connector whose first start failed, and `watch` streams every state change. Every result carries a `revision` that increases with each change and starts again when the Host restarts, so a client can drop a call result that arrives after a newer `watch` frame.

A connector package holds `mcp.json` at its root:

```json
{ "command": "python/python.exe", "args": ["-I", "-B", "${dir}/server.py"], "env": {}, "toolCallTimeoutMs": 60000 }
```

`command` must name a file inside the package; absolute paths and PATH lookups are refused. `${dir}` in `args` and `env` expands to the package directory, and no other placeholder is accepted. A Python interpreter must start with `-I`. The program runs with the package directory as its working directory. `parseLaunchManifest` and `readLaunchManifest` apply these rules, so Desktop's built-in connectors can use them too. A market connector id may not start with `custom-`.

A package may also hold `settings.json`, which declares values the user fills in, such as an API key; the file sits beside `mcp.json` because older builds refuse unknown `mcp.json` fields but ignore an unknown file:

```json
{ "settings": [{ "env": "CONTEXT7_API_KEY", "label": { "zh": "API key" }, "secret": true, "required": false, "url": "https://context7.com/dashboard" }] }
```

Each setting names the environment variable the program reads; it may not be one `mcp.json` already sets. `secret` defaults to `true` and `required` to `false`; at most 8 settings are allowed. The connector's view lists them under `settings` with `configured` and never a value. `saveConnectorSettings({ id, values })` saves trimmed values of 1 to 4096 characters, `null` clears one, and settings left out keep their value; a running connector restarts with the new values. A switched-on connector whose required setting has no value does not start; its view reports `hint: 'setting-required'`. `parseConnectorSettings` and `readConnectorSettings` apply these rules.

Custom connectors need no market package and no acceptance. `parseCustomConnectors({ text })` reads pasted JSON without saving it: the `mcpServers` form, VS Code's `servers`, a bare object of servers, one server, or a server copied without its outer braces, with comments and trailing commas allowed. Each server comes back with the configuration it would be saved with, or a `problem` code such as `sse` or `name-taken`. `saveCustomConnector({ config, previousName?, enabled? })` adds or changes one, and `removeCustomConnector({ name })` stops and deletes it. Names use letters, digits, `-` and `_`, at most 25 characters, unique without case; the connector's id and mcp-client `serverName` are `custom-<name>`. `setConnectorEnabled` and `retryConnector` take that id.

```json
{ "name": "time", "transport": "stdio", "command": "uvx", "args": ["mcp-server-time"], "env": {} }
```

A custom program uses the user's own runtime. Its command is looked up on the Host's PATH, and `npx` finds `npx.cmd` on Windows; its working directory defaults to the user's home. Its environment is the Host's scrubbed environment plus `env`, so a token such as `GITHUB_TOKEN` must be entered in `env`. A remote service sends its fixed `headers` with every request.

When a start fails, the connector's view carries the reason, a `hint` for common causes (`command-not-found`, `cwd-not-found`, `start-timeout`, `unauthorized`, `maybe-sse`, `unreachable`, `setting-required`), and for a local program the last lines it wrote to `stderr`. This applies to market connectors too.

<a id="understand-the-implementation"></a>
## Understand the implementation

Switch and acceptance records live in the `market_connectors` storage domain. Custom connector configurations, including environment and header values, live in plain text in the `market_custom_connectors` domain. Every market sync, connector switch, retry and custom connector change reconciles the running programs and services with the switched-on custom connectors and the installed, switched-on, accepted and valid market connectors. One whose package digest or custom configuration and resolved launch are unchanged keeps running, so the sync after each catalog read restarts nothing; changing a custom connector restarts it, and renaming it stops the old one and starts the new one. Before a custom program starts, its working directory and command are checked, because on Windows cross-spawn hands a missing command to `cmd.exe` and the SDK then reports only a closed connection. Before an install replaces a connector's directory, the market calls this package's `release`, which stops the program; the sync after the install starts the new version. Uninstall removes the record and syncs before the market deletes the files. A connector package's `SKILL.md` is served by the `market-connector` skill provider only while that connector is connected.

Setting values live in the credential store as one `api-key` record per connector, `market-connectors/<id>`, whose `env` holds the saved values; the package never holds them, so an update keeps them and an uninstall deletes the record. Each reconcile reads the record and adds only declared names to the program's environment, after `mcp.json`'s `env`. The restart fingerprint includes a SHA-256 digest of the values, never the values. A `credentials/record-updated` event for one of these records, including an edit of the credential file, reconciles again. When the record cannot be read, the connector reports the reason and does not start without its values.

<a id="model-experience"></a>
## Model Experience

### Connected connector tools

#### What the model sees

Each connected connector adds its MCP tools as `mcp__<connector id>__<tool>` and its server instructions as an `mcp:<connector id>` system prompt section, both through `dsh-mcp-client`. A connector's `SKILL.md` appears in the skill catalog while the connector is connected. When a connected market connector declares settings, the `market-connectors:settings` system prompt section below lists each declared variable as `saved` or `not saved`, never a value, with one line per such connector.

##### Market connector settings section

```markdown
Market connector settings. The user saves these values in the connector's detail dialog: 市场 → 连接器 → the connector → 设置. Desktop keeps them in its credential store and restarts the connector with them.
When a tool result shows a missing, wrong or rate-limited key, tell the user to open that dialog. Do not ask for the value in the conversation; if the user pastes one, ask them to save it in the dialog instead and suggest replacing the pasted key. Do not edit the connector's mcp.json or set environment variables: an update replaces the files, and Desktop does not pass environment variables named like keys or tokens to connectors.
- context7: CONTEXT7_API_KEY saved
```

#### Token effect

Every connected connector adds its full tool schemas and instructions to each request until it is switched off. The settings section adds about 150 tokens plus one line per connected connector that declares settings, and nothing when none does.

#### KV Cache effect

Connecting or disconnecting changes the tool list and the system prompt, so the next request misses the cache once. Saving or clearing a setting changes the settings section and restarts the connector, with the same one-time miss.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Connectors run with the user's own permissions, outside the sandbox, and their tool calls follow the profile's MCP tool policy. Catalog packages are verified by SHA-256 only; the catalog itself is not signed.
- Stopping a connector for a switch-off, update or uninstall ends any tool call it is serving.
- `connected` reflects the first start; a later disconnect shows only as failed tool calls while mcp-client reconnects.
- Market connectors are stdio programs. Custom connectors may be remote Streamable HTTP services with fixed headers; OAuth and SSE services are not supported.
- Custom connector environment and header values are stored in plain text with the configuration and returned to the page.
- Market connector setting values are protected only as the credential store protects them: the local store keeps them in a file only the user's account can read, which the agent's own tool processes can also read.
- A runtime installed while the Host runs, such as Node.js or uv, is found only after the Host restarts, because the Host keeps the PATH it started with.

### Dev Note

<a id="dev-note"></a>

None.

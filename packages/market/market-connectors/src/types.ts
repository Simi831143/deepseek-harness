/** JSON values of the `marketConnectors` Remote namespace. */
import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The connector is not installed, so there is no program to start. */
    'market-connectors/not-installed': { readonly id: string }
    /** The first connection of a connector needs the user to accept the program it runs. */
    'market-connectors/confirmation-required': { readonly id: string }
    /** The connector's `mcp.json` cannot start a program. */
    'market-connectors/invalid-manifest': { readonly id: string; readonly reason: string }
    /** The connector state could not be saved. */
    'market-connectors/state-unavailable': { readonly id: string; readonly reason: string }
    /** A custom connector's configuration breaks a rule; `problem` says which. */
    'market-connectors/invalid-custom': { readonly name: string; readonly problem: CustomProblem; readonly detail?: string }
    /** Another custom connector already uses this name, compared without case. */
    'market-connectors/name-taken': { readonly name: string }
    /** No custom connector has this name. */
    'market-connectors/not-found': { readonly name: string }
    /** The connector declares no setting under this environment variable name. */
    'market-connectors/unknown-setting': { readonly id: string; readonly env: string }
    /** A setting value is empty or longer than the limit. */
    'market-connectors/invalid-setting': { readonly id: string; readonly env: string }
    /** The credential store could not save or read the connector's settings. */
    'market-connectors/settings-unavailable': { readonly id: string; readonly reason: string }
  }
}

/**
 * Runtime state of one installed connector: `off` when not enabled, `starting` while its program
 * starts and lists its tools, `connected` once the tools are registered, `failed` when the first
 * start failed. A failed connector stays failed until it is retried, switched off, or updated.
 */
export type ConnectorState = 'off' | 'starting' | 'connected' | 'failed'

/** The program a connector runs. */
export interface ConnectorLaunchView {
  /**
   * A market connector's command path relative to its package, as `mcp.json` writes it;
   * a custom connector's command as the user wrote it.
   */
  readonly command: string
  /** Arguments; a market connector's have `${dir}` replaced by the package directory. */
  readonly args: readonly string[]
}

/** Where a connector comes from: a market package, or a configuration the user added. */
export type ConnectorOrigin = 'market' | 'custom'

/**
 * A common cause of a failed start that the page explains in the user's language:
 * - `command-not-found`: the command is not on PATH, or its file does not exist.
 * - `cwd-not-found`: the working directory does not exist.
 * - `start-timeout`: the program did not answer in time; a first `npx` or `uvx` start downloads its package.
 * - `unauthorized`: the remote service answered 401 or 403.
 * - `maybe-sse`: the address may be an SSE service, which is not supported.
 * - `unreachable`: the address could not be reached.
 * - `setting-required`: a market connector is switched on but a required setting has no value, so it does not start.
 */
export type ConnectorHint =
  | 'command-not-found' | 'cwd-not-found' | 'start-timeout' | 'unauthorized' | 'maybe-sse' | 'unreachable' | 'setting-required'

/** A local program a custom connector starts and talks to over stdio. */
export interface CustomStdioConfig {
  /** Connector name: letters, digits, `-` and `_`, at most 25 characters. */
  readonly name: string
  readonly transport: 'stdio'
  /** Program to start: a name looked up on PATH, such as `npx`, or a path. */
  readonly command: string
  readonly args: readonly string[]
  /** Environment variables added on top of the Host environment, which carries no credentials. */
  readonly env: Readonly<Record<string, string>>
  /** Absolute working directory; the user's home directory when absent. */
  readonly cwd?: string
  /** Timeout of one tool call in milliseconds; 60 seconds when absent. */
  readonly toolCallTimeoutMs?: number
}

/** A remote MCP service a custom connector reaches over Streamable HTTP. */
export interface CustomHttpConfig {
  /** Connector name: letters, digits, `-` and `_`, at most 25 characters. */
  readonly name: string
  readonly transport: 'streamable-http'
  /** `http` or `https` address of the MCP endpoint. */
  readonly url: string
  /** Fixed headers sent with every request, such as `Authorization`. */
  readonly headers: Readonly<Record<string, string>>
  /** Timeout of one tool call in milliseconds; 60 seconds when absent. */
  readonly toolCallTimeoutMs?: number
}

/** One MCP server the user added outside the market. */
export type CustomConnectorConfig = CustomStdioConfig | CustomHttpConfig

/**
 * Why a custom connector configuration was refused:
 * - `not-json`: the pasted text is not JSON; `detail` is the parser's message.
 * - `no-servers`: the pasted JSON names no server.
 * - `invalid-name`: the name breaks the name rule.
 * - `name-taken`: another custom connector uses the name.
 * - `sse`: the server uses the SSE transport, which is not supported.
 * - `unknown-type`: `type` is not `stdio`, `http` or `streamable-http`; `detail` is the type.
 * - `no-command-or-url`: the server has neither a command nor a URL.
 * - `invalid-url`: the URL is not an `http` or `https` address.
 * - `cwd-not-absolute`: the working directory is not an absolute path.
 * - `invalid-field`: a field has the wrong type or value; `detail` names the field.
 */
export type CustomProblem =
  | 'not-json' | 'no-servers' | 'invalid-name' | 'name-taken' | 'sse' | 'unknown-type'
  | 'no-command-or-url' | 'invalid-url' | 'cwd-not-absolute' | 'invalid-field'

/** One installed or added connector. */
export interface ConnectorView {
  /** Catalog id of a market connector; `custom-<name>` for a custom one. */
  readonly id: string
  readonly origin: ConnectorOrigin
  /** Whether the user switched the connector on; it starts when it is also valid and confirmed. */
  readonly enabled: boolean
  /** Whether the user accepted the program this connector runs; always true for a custom connector. */
  readonly confirmed: boolean
  readonly state: ConnectorState
  /** Why the start failed or why `mcp.json` was refused. */
  readonly error?: string
  /** With a failed start: a common cause the page can explain. */
  readonly hint?: ConnectorHint
  /** With a failed start of a local program: the last lines it wrote to stderr, oldest first. */
  readonly stderr?: readonly string[]
  /** The program the connector runs; absent when `mcp.json` was refused and for a remote custom connector. */
  readonly launch?: ConnectorLaunchView
  /** A custom connector's configuration, including environment and header values. */
  readonly custom?: CustomConnectorConfig
  /** Values a market connector's `settings.json` asks for, with whether each is saved; never the values. */
  readonly settings?: readonly ConnectorSettingView[]
}

/** One value a market connector asks the user for, as the page shows it. */
export interface ConnectorSettingView {
  /** Environment variable the program reads the value from; also the setting's key in requests. */
  readonly env: string
  readonly label: { readonly zh: string; readonly en?: string }
  readonly description?: { readonly zh: string; readonly en?: string }
  /** Whether the value is a secret; a saved secret is never sent back. */
  readonly secret: boolean
  /** Whether the connector cannot start without the value. */
  readonly required: boolean
  /** Page where the user gets the value. */
  readonly url?: string
  /** Whether a value is saved. */
  readonly configured: boolean
}

/** Save or clear the settings of one market connector. */
export interface ConnectorSettingsRequest {
  readonly id: string
  /**
   * New values by environment variable name; `null` clears one. Settings left out keep their
   * value. A running connector restarts with the new values.
   */
  readonly values: Readonly<Record<string, string | null>>
}

/** Every connector: custom connectors by name, then market connectors by id. */
export interface ConnectorsValue {
  /**
   * Increases with every change and starts again when the Host restarts. A call's result and the
   * `watch` frames reach the browser on different channels, so a result can arrive after a newer
   * frame; the browser takes every frame and drops a result whose revision is lower than the one it shows.
   */
  readonly revision: number
  readonly connectors: readonly ConnectorView[]
}

/** Pasted text that holds MCP server configurations. */
export interface ParseCustomRequest {
  /** JSON such as `{ "mcpServers": { ... } }`; comments and trailing commas are allowed. */
  readonly text: string
}

/** One server found in pasted text. */
export interface ParsedCustomEntry {
  /** Name the connector would get. */
  readonly name: string
  /** The key the pasted JSON used, when it had to change to fit the name rule. */
  readonly renamedFrom?: string
  /** The configuration to save; absent when `problem` is set. */
  readonly config?: CustomConnectorConfig
  /** False when the pasted JSON marked the server `disabled`. */
  readonly enabled: boolean
  /** Fields of the pasted server that were not used, such as `autoApprove`. */
  readonly ignored: readonly string[]
  /** Why this server cannot be added. */
  readonly problem?: CustomProblem
  readonly detail?: string
}

/** What pasted text holds; nothing is saved. */
export interface ParsedCustomConnectors {
  readonly entries: readonly ParsedCustomEntry[]
  /** Why the text as a whole could not be read: `not-json` or `no-servers`. */
  readonly problem?: CustomProblem
  readonly detail?: string
}

/** Add a custom connector, or change one. */
export interface SaveCustomRequest {
  /** Name of the connector being changed; absent when adding. */
  readonly previousName?: string
  readonly config: CustomConnectorConfig
  /** Whether it runs; a new connector runs and a changed one keeps its switch when absent. */
  readonly enabled?: boolean
}

/** One custom connector addressed by name. */
export interface CustomNameRequest {
  readonly name: string
}

/** Switch one connector on or off. */
export interface ConnectorSwitchRequest {
  readonly id: string
  readonly enabled: boolean
  /** Required as `true` the first time a connector is switched on; records that the user accepted its program. */
  readonly confirmed?: boolean
}

/** One connector addressed by id. */
export interface ConnectorIdRequest {
  readonly id: string
}

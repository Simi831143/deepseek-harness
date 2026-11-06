---
description: "Browser market page for browsing, installing, switching, and removing market skills."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-market

English | [中文](README.zh.md)

## Summary

The market client plugin presents catalog skills and connectors in a browser page, follows Host installation and connector state, and lets users install, enable, disable, edit, or remove market and personal skills connect, disconnect, update, or remove market connectors, and add, edit, or delete custom connectors. It mounts the `market`, `marketSkills`, and `marketConnectors` Remote namespaces that it consumes and reveals skill folders through the `session` namespace.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the plugin with the Web client and the Host market bundle. Open the Market panel to browse skill categories, inspect a skill, install it, and manage the installed list. The page refreshes skill labels and slash-menu candidates after an install, switch, or deletion.

Every installed skill's detail dialog has one More actions menu, whether the skill came from the market or a personal folder:

- **Edit** opens a new conversation whose composer reads `/skill-creator 请帮我编辑 /<skill> 这个 skill`, with both names as skill chips, unsent.
- **Open folder** shows the skill's instruction file selected in the Host file manager. It appears only when the Host reports a desktop and the skill has a file path.
- **Uninstall** asks for confirmation. A market skill is uninstalled through the market; a personal skill's folder is deleted.

The Connectors tab appears when the Host mounts the connector kind. **Connect** installs a connector that is not installed yet; the first connection shows the program the connector runs and starts it only after the user accepts. An accepted connector switches from its card. The detail dialog shows the connector's state and start failure, and offers Retry, Update, and Uninstall.

**Add connector** adds MCP servers the user configures: paste the JSON an MCP project publishes, which may hold several servers and shows each one with its problem before anything is saved, or fill in one server with its whole command line or URL, environment variables or headers one per line, and a timeout, with the resulting JSON shown below. Custom connectors come first in the grid with a Custom tag and their command or URL, and switch from their card. Editing keeps the type; to change it, delete the connector and add it again. Their detail dialog hides environment and header values until shown, and offers Edit and Delete. A failed start shows a hint for common causes, the Host's reason, and the program's last stderr lines; **Ask the assistant** opens a new conversation with the connector's configuration and failure, listing environment and header names without their values.

While a skill or connector installs, its card shows a progress bar and its detail dialog shows the step with a bar: megabytes downloaded, then files unpacked.

<a id="understand-the-implementation"></a>
## Understand the implementation

The client keeps one observable store for catalog and installed-skill streams. User actions call the typed Remote methods and surface success or failure through the page and a persistent toast. A connector call's result can reach the browser after a newer frame of the connector stream, because calls and streams use different channels; the store keeps every stream frame and drops a call result whose `revision` is lower than the one shown, so a retry that already failed again does not stay at Starting. The plugin contributes the main panel, navigation entry, and skill labels used by `ui-skill`.

<a id="model-experience"></a>
## Model Experience

### Installed skill discovery

#### What the model sees

The page adds no prompt text. Enabling a skill changes `ctx.skills`, so the existing skill catalog can expose it to the model according to its invocation policy.

#### Token effect

None while browsing. A later skill invocation accounts for the instruction body through the existing skill consumer.

#### KV Cache effect

None directly; model-visible skill content is owned by the Host skill consumer.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The page requires the Host market Remote namespaces and shows the last available catalog when the catalog endpoint is offline.
- Deleting a personal skill cannot be undone from the page; the files are removed, not moved to the recycle bin.
- Edit relies on the `skill-creator` skill; a composition without it sends the chip as plain text.

### Dev Note

<a id="dev-note"></a>

None.

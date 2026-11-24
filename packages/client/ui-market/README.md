---
description: "Unified market page for browsing, installing, updating, and removing skills, connectors, and plugins."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-market

English | [中文](README.zh.md)

## Summary

The Market page has three tabs: Skills, Connectors, and Plugins. It opens on Skills by default. Users can install, update, and remove market packages through one Host market service, manage skill switches and personal skills, and connect or configure MCP servers. The page follows installation and connector state and reports operation outcomes through a persistent toast.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the plugin with the Web client and the Host market bundle. Open the Market panel to browse skill categories, inspect a skill, install it, and manage the installed list. The page refreshes skill labels and slash-menu candidates after an install, switch, or deletion.

While the page is open, a newly published, removed, or updated item appears without leaving the page. The page reads the catalog again when the user switches tabs, when the window regains focus or becomes visible, and every `catalogRevalidateMs` (60,000 ms by default) while the window is visible; a hidden window starts no timed reads. Each read sends the cached ETag, so an unchanged catalog costs one 304 response, and the Host publishes no snapshot for it. `catalogRevalidateMs` is a volatile field of the `ui-market` row: a change in `cordis.yml` reaches open pages and applies from the next scheduled read. A failed background read shows no toast; the page keeps the last catalog and its offline notice.

In the Skills tab, **Add skill → Find skills** opens a new conversation, focuses the composer, and fills in a localized request to find and automatically install a skill. Describe the capability between `「」`, then send it. The request stays unsent until then; the assistant uses the capabilities available in that conversation to carry it out. **Create skill** opens a new conversation with the `skill-creator` chip and a request template, also unsent.

**Add skill → Upload skill** imports one local `.md` or `.zip` as a personal skill without opening a conversation. Drag a file into the dashed area or click it to choose a file, review its name and size, then install it. The dialog lists the archive layout and YAML frontmatter requirements. Dropping several files or a folder shows an error and retains the previous selection. The Host validates the skill and archive before publishing it; [market-skills](../../market/market-skills/README.md) owns the accepted structure and installation directory. A same-name skill is rejected without replacement, including disabled skills. Errors remain in the dialog so the selected file can be retried or changed. If the connection loses the outcome, check the installed list before retrying. A successful upload opens the installed list and refreshes slash-menu candidates.

Every installed skill's detail dialog has one More actions menu, whether the skill came from the market or a personal folder:

- **Edit** opens a new conversation whose composer reads `/skill-creator 请帮我编辑 /<skill> 这个 skill`, with both names as skill chips, unsent.
- **Open folder** shows a personal skill's instruction file selected in the Host file manager. It appears only for personal skills when the Host reports a desktop and the skill has a file path; market-downloaded skills hide it.
- **Uninstall** asks for confirmation. A market skill is uninstalled through the market; a personal skill's folder is deleted.

The Connectors tab appears when the Host mounts the connector kind. **Connect** installs a connector that is not installed yet; the first connection shows the program the connector runs and starts it only after the user accepts. An accepted connector switches from its card. The detail dialog shows the connector's state and start failure, and offers Retry, Update, and Uninstall.

**Add connector** adds MCP servers the user configures: paste the JSON an MCP project publishes, which may hold several servers and shows each one with its problem before anything is saved, or fill in one server with its whole command line or URL, environment variables or headers one per line, and a timeout, with the resulting JSON shown below. Custom connectors come first in the grid with a Custom tag and their command or URL, and switch from their card. Editing keeps the type; to change it, delete the connector and add it again. Their detail dialog hides environment and header values until shown, and offers Edit and Delete. A failed start shows a hint for common causes, the Host's reason, and the program's last stderr lines; **Ask the assistant** opens a new conversation with the connector's configuration and failure, listing environment and header names without their values.

The Plugins tab searches plugin titles, descriptions, and package names and filters the published categories. Details show the installed version and let users select a published version. Compatibility comes from the Host; an incompatible version shows its reason and cannot be installed. Installation asks for confirmation because plugin code runs with the user's permissions and affects the profile's conversations. Application-provided plugins cannot be replaced or removed here. Plugin switches and configuration remain on the Plugins management page.

While a market package installs, its card shows a progress bar and its detail dialog shows the step: megabytes downloaded, files unpacked, then an indeterminate package-installation step when required. Plugins use the same `market` install, update, removal, progress, and toast paths as skills and connectors. Removing an installed plugin asks for confirmation before the Host unloads it and deletes its package files.

<a id="understand-the-implementation"></a>
## Understand the implementation

The client keeps one observable store for catalog and installed-skill streams. User actions call the typed Remote methods and surface success or failure through the page and a persistent toast. A connector call's result can reach the browser after a newer frame of the connector stream, because calls and streams use different channels; the store keeps every stream frame and drops a call result whose `revision` is lower than the one shown, so a retry that already failed again does not stay at Starting. The plugin contributes the main panel, navigation entry, and skill labels used by `ui-skill`.

<a id="model-experience"></a>
## Model Experience

### Installed skill discovery

#### What the model sees

Browsing adds no prompt text. Find, create, edit, and connector diagnosis actions prepare editable drafts; only sending a draft adds its request to the conversation. Enabling a skill changes `ctx.skills`, so the existing skill catalog can expose it to the model according to its invocation policy.

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

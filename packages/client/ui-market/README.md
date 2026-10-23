---
description: "Browser market page for browsing, installing, switching, and removing market skills."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-market

English | [中文](README.zh.md)

## Summary

The market client plugin presents catalog skills in a browser page, follows Host installation state, and lets users install, enable, disable, or remove market skills. It mounts the `market` and `marketSkills` Remote namespaces that it consumes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the plugin with the Web client and the Host market bundle. Open the Market panel to browse skill categories, inspect a skill, install it, and manage the installed list. The page refreshes skill labels and slash-menu candidates after an install or switch.

<a id="understand-the-implementation"></a>
## Understand the implementation

The client keeps one observable store for catalog and installed-skill streams. User actions call the typed Remote methods and surface success or failure through the page and a persistent toast. The plugin contributes the main panel, navigation entry, and skill labels used by `ui-skill`.

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
- Only market-installed skills can be removed from this page; personal skills can be switched off but their files remain user-owned.

### Dev Note

<a id="dev-note"></a>

None.

---
description: "Profile bundle that mounts one market for experts, skills, connectors, and plugins."
kind: "package-bundle"
---

# @deepseek-ai/dsh-market-bundle

English | [中文](README.zh.md)

## Summary

This bundle adds one Market page for experts, skills, connectors, and plugins, with shared catalog reads and verified package downloads. It also provides installed-skill switches, local MCP connectors, and profile plugin installation. It is an optional product layer and does not change the base profile when it is absent.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Add the bundle to a `dsh` profile through the profile composer. The bundle patch mounts `dsh-market`, `dsh-market-skills`, `dsh-market-connectors`, `dsh-market-plugins`, and `dsh-client-ui-market`. Configure the shared catalog through the `market` row's `catalogUrl`. The plugin adapter requires a profile and its Plugin Manager.

<a id="understand-the-implementation"></a>
## Understand the implementation

`cordis.patch.yml` contributes the Host services and browser plugin. The bundle owns composition only; catalog reads, verified downloads, operation progress, and dispatch live in `dsh-market`. Each market domain owns content validation and runtime changes. The plugin adapter delegates dependency and profile changes to Plugin Manager; plugin enablement and configuration remain available on the Plugins page.

<a id="model-experience"></a>
## Model Experience

### Market composition

#### What the model sees

Nothing from the bundle itself. Installed skills become model-visible through `ctx.skills` when the profile also includes skill discovery and loading, and connected connectors add their MCP tools through `ctx.tools`.

#### Token effect

None from the bundle layer. The installed skill consumer accounts for any loaded instruction body, and `dsh-market-connectors` documents the tool schemas a connected connector adds.

#### KV Cache effect

None directly. Installed skill content is owned by the skill registry and its model-facing consumer.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The bundle expects a reachable catalog URL and a profile with the shared skill services; it does not provide a catalog server or a fallback package registry.

### Dev Note

<a id="dev-note"></a>

None.

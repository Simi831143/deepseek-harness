---
description: "Profile bundle that mounts the market catalog, skill installation, and browser market page."
kind: "package-bundle"
---

# @deepseek-ai/dsh-market-bundle

English | [中文](README.zh.md)

## Summary

This bundle adds the market catalog, verified skill installation, installed-skill switches, and the browser Market page to a profile. It is an optional product layer and does not change the base profile when it is absent.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Add the bundle to a `dsh` profile through the profile composer. The bundle patch mounts `dsh-market`, `dsh-market-skills`, and `dsh-client-ui-market` together so the Host and browser use the same catalog and installed records.

<a id="understand-the-implementation"></a>
## Understand the implementation

`cordis.patch.yml` contributes the Host services and browser plugin. The bundle owns composition only; catalog fetching and archive verification live in `dsh-market`, while skill records and enablement live in `dsh-market-skills`.

<a id="model-experience"></a>
## Model Experience

### Market composition

#### What the model sees

Nothing from the bundle itself. Installed skills become model-visible through `ctx.skills` when the profile also includes skill discovery and loading.

#### Token effect

None from the bundle layer. The installed skill consumer accounts for any loaded instruction body.

#### KV Cache effect

None directly. Installed skill content is owned by the skill registry and its model-facing consumer.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The bundle expects a reachable catalog URL and a profile with the shared skill services; it does not provide a catalog server or a fallback package registry.

### Dev Note

<a id="dev-note"></a>

None.

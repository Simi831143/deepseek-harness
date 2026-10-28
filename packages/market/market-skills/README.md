---
description: "Market skill kind, installed skill provider, and enablement Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-market-skills

English | [中文](README.zh.md)

## Summary

`dsh-market-skills` registers the market skill kind, exposes installed market and personal skills through `ctx.marketSkills`, and contributes installed market directories to the shared skill registry. One enablement setting applies across every skill source, and personal skills can be deleted from their folder.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this package beside `dsh-market`, the skill registry, settings, and working-directory services. Use the `marketSkills` Remote to list installed skills, read a skill document, change enablement, or delete a personal skill. The market's `uninstallPackage` removes market downloads. `uninstallPersonal` deletes a personal skill's directory, or its Markdown file, from `<DSH home>/skills` or `~/.agents/skills`; it removes a linked skill's link and keeps the linked directory, and it refuses skills from any other source.

<a id="understand-the-implementation"></a>
## Understand the implementation

The provider watches the market kind directory and the user's skill directory, resolves the active preset, and registers one scoped provider with the shared registry. The management Remote returns stable installed views and writes the shared `disabled` setting for enablement changes.

<a id="model-experience"></a>
## Model Experience

### Installed skill provider

#### What the model sees

Enabled skills can appear in the model-facing `skill` catalog and load through the existing `skill` tool. This package contributes installed content and policy; rendering remains owned by the shared skill consumer.

#### Token effect

An invocation adds the selected skill body through the existing skill consumer; this package adds no separate prompt text.

#### KV Cache effect

Skill catalog changes append a replacement catalog through the existing consumer; this package does not edit prior model messages.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The package depends on `dsh-market` for archive lifecycle and on the shared settings service for enablement persistence.
- A disabled skill remains installed and visible to management callers, but ordinary model and user lookups omit it.

### Dev Note

<a id="dev-note"></a>

None.

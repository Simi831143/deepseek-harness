---
description: "Market skill kind, installed skill provider, and enablement Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-market-skills

English | [中文](README.zh.md)

## Summary

`dsh-market-skills` registers the market skill kind, imports personal skills from ZIP or Markdown, exposes installed market and personal skills through `ctx.marketSkills`, and contributes installed market directories to the shared skill registry. One enablement setting applies across every skill source, and personal skills can be deleted from their folder.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this package beside `dsh-market`, the skill registry, settings, and working-directory services. Use the `marketSkills` Remote to list installed skills, read a skill document, change enablement, or delete a personal skill. The market's `uninstallPackage` removes market downloads. `uninstallPersonal` deletes a personal skill's directory, or its Markdown file, from `<DSH home>/skills` or `~/.agents/skills`; it removes a linked skill's link and keeps the linked directory, and it refuses skills from any other source.

`importSkill({ fileName, data }, signal)` accepts one `.zip` or `.md` file encoded as canonical base64 and installs it under `<DSH home>/skills/<name>`, using the `SKILL.md` frontmatter name. Markdown requires valid UTF-8, YAML frontmatter, name, description and invocation policy. ZIP accepts a root `SKILL.md` or one enclosing folder, retains resources, and rejects additional nested skills, unsafe paths, links and conflicting file names. Import never executes scripts or installs dependencies.

Import applies no byte-size or ZIP entry-count limit. Validation failures return `market-skills/import-invalid`; an existing visible skill, disabled skill or personal destination path returns `market-skills/import-conflict` without replacing it. File failures before publication return `market-skills/import-failed`. Cancellation before publication cleans staging; a completed publication returns its name without a subsequent list read. Existing disabled-name settings remain in effect.

<a id="understand-the-implementation"></a>
## Understand the implementation

The market provider contributes recorded market downloads; personal directories are discovered by the existing filesystem skill provider. Management reads use the default preset's scope. Imports extract into a private directory outside skill roots, validate with the serving parser, check name conflicts under a cross-process lock shared with personal deletion, then publish the complete directory and invalidate the registry. Unload cancels and awaits admitted imports. The management Remote writes the shared `disabled` setting for enablement changes.

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

- Market downloads depend on `dsh-market`; personal uploads use in-memory transport and do not support replacement or merging. Shared settings own enablement persistence.
- A disabled skill remains installed and visible to management callers, but ordinary model and user lookups omit it.

### Dev Note

<a id="dev-note"></a>

None.

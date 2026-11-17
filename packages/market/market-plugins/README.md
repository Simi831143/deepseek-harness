---
description: "Install and remove profile plugins through the shared market."
kind: "package-reference"
---

# @deepseek-ai/dsh-market-plugins

English | [中文](README.zh.md)

## Summary

Install, update, and uninstall published plugins from the same market used for skills and connectors. Plugin Manager owns the profile dependency and runtime state; the market supplies the catalog, verified downloads, operation progress, and browser results.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount this plugin beside `dsh-market` and the current profile's `dsh-plugin-manager`. The [market bundle](../../bundle/market/README.md) supplies this composition. Plugin requests use the market's existing `installPackage` and `uninstallPackage` operations with `kind: 'plugin'` and the npm package name as `id`. An optional exact `version` selects a published version.

The market verifies the download size and SHA-256 before this plugin reads its manifest. The manifest must name the selected package and version and declare a bundle. `manifestMaxBytes` limits its uncompressed size to 1 MiB by default. The selected version must satisfy DSH compatibility or an existing exact-version exemption. Application-provided plugins cannot be replaced or removed here.

Updating removes the old dependency before installing the new one and preserves its enabled selection. An installation that needs a Host restart reports `restartRequired` in the market state. If removal succeeds and the replacement fails, the dependency stays uninstalled; inspect the Plugins page before retrying. Profiles without HMR cannot remove a plugin still in use by the running Host.

<a id="understand-the-implementation"></a>
## Understand the implementation

This plugin registers one managed kind with the [market service](../market/README.md). Installation state comes from Plugin Manager rather than a second market installation record. A verified tarball is saved at a unique path under `<profile>/.plugin-market/tarballs` because pnpm records the local file as a dependency source. Files remain while any profile dependency references them; successful removal uses [Plugin Manager's cleanup](../../boot/plugin-manager/README.md#failure-behavior). Failed preparations delete an unreferenced new file, while an activation failure that retained its dependency retains that source file. Cancellation waits for the manager's owned installation to settle. Manager changes refresh the shared market stream. Unloading rejects new operations, cancels active installations, and waits for accepted operations and refreshes before withdrawing the kind; a removal already committed is preserved.

<a id="model-experience"></a>
## Model Experience

### Plugin installation

#### What the model sees

Nothing directly. Existing `plugin_manager` consumers keep their own authorization and presentation.

#### Token effect

None directly; installed plugins account for the tools and prompts they contribute.

#### KV Cache effect

None directly.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This market flow installs published tarballs. npm and Git index versions remain visible but cannot be installed through this verified archive flow.
- Removal cannot be interrupted once Plugin Manager begins it. Its committed result remains authoritative when a caller cancels.
- Package build-script approval remains managed by Plugin Manager; a blocked installation reports its failure without granting script permissions.

### Dev Note

<a id="dev-note"></a>

None.

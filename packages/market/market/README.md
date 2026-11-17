---
description: "Host market catalog, verified archive installation, and installed-item records."
kind: "package-reference"
---

# @deepseek-ai/dsh-market

English | [中文](README.zh.md)

## Summary

Browse experts, skills, connectors, and plugins through one catalog and install or remove them through the `market` Remote namespace. Each resource type supplies its content validation and runtime integration.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount `Market` with a catalog URL and a writable market home. Register each supported item kind through `registerKind()`, then use `catalogSnapshot()`, `installItem()`, and `uninstallPackage()` from Host consumers or the typed `market` Remote namespace.

<a id="understand-the-implementation"></a>
## Understand the implementation

The service reads one JSON catalog over HTTP(S), including its published plugin versions, and keeps the last valid catalog for browsing. Every installation revalidates that catalog with its ETag; an unsuccessful read stops installation with `market/catalog-unavailable`. A removed item or exact version is refused, and package downloads verify both size and SHA-256. Downloaded archives are never reused for another installation.

Archive kinds validate a staging directory before replacing installed files, with installed records owned by the market. Managed kinds receive the same verified package bytes and supply their installation, removal, and authoritative installed state. The [plugin adapter](../market-plugins/README.md) delegates profile dependencies and runtime changes to Plugin Manager. `watch()` publishes all kinds through the same snapshot, including download, unpacking, and package-installation progress. Managed operations refresh their installed state after success or failure so a committed dependency removal is not presented as rolled back.

Archive updates delete their replaced copy after installation returns; the next startup finishes interrupted staging cleanup. Archive removal withdraws runtime contributions before deleting the installed directory. Plugin archive retention and removal follow the [Plugin Manager cleanup rules](../../boot/plugin-manager/README.md#failure-behavior).

<a id="model-experience"></a>
## Model Experience

### Catalog and installation service

#### What the model sees

Nothing directly. A registered domain may make installed content model-visible through its own `ctx.skills` or tool consumer.

#### Token effect

None directly; the consuming domain accounts for any installed content it loads.

#### KV Cache effect

None directly.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The catalog URL is configured by the deployment and the service does not sign or mirror catalog data.
- Installation is limited to registered kinds. The shared plugin market accepts published tarballs; npm and Git installation remain available through Plugin Manager.

### Dev Note

<a id="dev-note"></a>

None.

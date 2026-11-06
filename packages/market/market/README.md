---
description: "Host market catalog, verified archive installation, and installed-item records."
kind: "package-reference"
---

# @deepseek-ai/dsh-market

English | [中文](README.zh.md)

## Summary

`dsh-market` owns the published market catalog, verified archive extraction, installed-item records, and the `ctx.market` Host service. Domain packages register item kinds and own the validation of their installed content.

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

The service downloads JSON over HTTP(S), keeps the last valid catalog on disk, reads the catalog again (with its ETag) before every install so a page opened before a publish installs the package now listed, verifies package metadata and SHA-256 content, extracts into a staging directory, and atomically promotes the completed package. Installed records are stored through the storage-domain service and catalog changes are delivered by `watch()`. While a package downloads and unpacks, the snapshot's `progress` reports the bytes received and the files written, and `watch()` sends a new snapshot each time the whole percent changes. The copy that an update replaces is deleted after the install returns; a deletion cut short by exit finishes when the next start empties the staging directory.

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
- Archive installation is limited to the registered item kinds and their package validators.

### Dev Note

<a id="dev-note"></a>

None.

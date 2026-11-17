---
description: "Shared market catalog and package operations for skills, connectors, and plugins."
kind: "package-group"
---

# market/ - market capabilities

English | [中文](README.zh.md)

## Summary

The `market/` group owns the catalog and installation services used by the optional market bundle. The core package manages the shared catalog, verified downloads, and package operations. Domain packages connect installed content to the skill registry, start enabled MCP connectors, or install profile plugins through Plugin Manager.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`market`](market/README.md) | Catalog, package verification, installation, and removal | `ctx.market` |
| [`market-skills`](market-skills/README.md) | Installed skill provider and management Remote | `ctx.marketSkills` |
| [`market-connectors`](market-connectors/README.md) | Local MCP connector programs, switches and their skills | `ctx.marketConnectors` |
| [`market-plugins`](market-plugins/README.md) | Market plugin installation through the profile's Plugin Manager | `ctx.market` registration |

<a id="related-documentation"></a>
## Related documentation

- [Skills subsystem](../../docs/subsystems/skills.md) - generated service and type reference.
- [Market UI](../client/ui-market/README.md) - browser catalog and installed-skill management.
- [Market bundle](../bundle/market/README.md) - profile patch that mounts the host and browser packages.

<a id="dev-note"></a>
### Dev Note

None.

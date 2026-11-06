---
description: "Market catalog, verified package installation, and installed skill management."
kind: "package-group"
---

# market/ - market capabilities

English | [中文](README.zh.md)

## Summary

The `market/` group owns the catalog and installation services used by the optional market bundle. The core package manages catalog data and verified archives; the skill package connects installed archives to the shared skill registry and exposes management operations; the connector package starts installed MCP programs the user switched on.

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

<a id="related-documentation"></a>
## Related documentation

- [Skills subsystem](../../docs/subsystems/skills.md) - generated service and type reference.
- [Market UI](../client/ui-market/README.md) - browser catalog and installed-skill management.
- [Market bundle](../bundle/market/README.md) - profile patch that mounts the host and browser packages.

<a id="dev-note"></a>
### Dev Note

None.

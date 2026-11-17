---
kind: upgrade-guide
description: "The optional market bundle replaces its separate plugin-market rows with a plugin adapter on the shared market."
---

# Plugin discovery joins the shared market

English | [中文](guide.zh.md)

## Change

The optional `@deepseek-ai/dsh-market-bundle` presents plugins as the fourth Market tab. Its `lc-plugin-market` and `lc-ui-plugin-market` rows are replaced by `market-plugins`, which uses the existing `market` row's catalog URL. The bundle no longer mounts a second catalog reader or contributes a Discover tab to the Plugins page. The Plugins page continues to manage installed plugin enablement, configuration, and runtime state.

Installation requires a successful catalog revalidation. A failed catalog request can leave the previous catalog visible, but it prevents a new installation from that catalog.

## Migration

1. In profile `cordis.patch.yml` files or deployment overlays, remove overrides targeting `lc-plugin-market` or `lc-ui-plugin-market`. Put the catalog address in `config.catalogUrl` on the `market` row instead of `config.indexes` on `lc-plugin-market`.
2. Keep the profile's Plugin Manager available when mounting `market-plugins`. Existing plugin dependencies and installed skill and connector files remain in their current locations.
3. Restart the application, open Market, and confirm the Experts, Skills, Connectors, and Plugins tabs appear. Install market plugins from the Plugins tab and manage their configuration on the application's Plugins page.

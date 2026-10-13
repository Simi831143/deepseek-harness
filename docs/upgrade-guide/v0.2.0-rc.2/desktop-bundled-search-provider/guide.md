---
kind: upgrade-guide
description: "Desktop no longer bundles the Exa search plugin; it bundles the AnySearch search plugin instead."
---

# Desktop bundled search provider changes

English | [中文](guide.zh.md)

## Change

Desktop builds before this change bundled `dsh-bundle-exa-search`, which supplied the `exa` search provider and the `exa-search` settings row. New builds bundle `dsh-bundle-anysearch-search`, which supplies the `anysearch` provider and the `anysearch-search` settings row instead.

When a Desktop profile starts after the upgrade, built-in plugin reconciliation removes the owned Exa package and bundle entry, then installs and enables AnySearch. A package that the user installed independently is not owned by the Desktop build and is left unchanged. Existing profile configuration files remain on disk, but Exa-specific rows and `searchProvider: exa` no longer select the built-in provider.

## Migration

1. Start Desktop once for each profile that used the built-in search plugin. This lets startup remove the owned `dsh-bundle-exa-search` entry and add `dsh-bundle-anysearch-search` without running a package installation.
2. If a profile or overlay explicitly sets `searchProvider: exa`, change it to `searchProvider: anysearch`. Move settings overrides from the `exa-search` row to the `anysearch-search` row, and configure an AnySearch key when anonymous access is insufficient.
3. Confirm the profile's `package.json` lists `dsh-bundle-anysearch-search` in `dependencies` and `dsh.profile.bundles`, does not list the owned Exa package, and the Plugins page shows AnySearch enabled.

---
kind: upgrade-guide
description: "Desktop's bundled AnySearch plugin package is renamed from `dsh-bundle-anysearch-search` to `anysearch-search`."
---

# Desktop's bundled AnySearch plugin is renamed `anysearch-search`

English | [中文](guide.zh.md)

## Change

Desktop builds before this change bundled the AnySearch search plugin as the package `dsh-bundle-anysearch-search`, built from a checkout of the same name beside this repository. New builds bundle it as `anysearch-search`, from a checkout named `anysearch-search`. The plugin page shows its localized title instead of the package name.

The `anysearch` provider id, the `anysearch-search` settings row, the `ANYSEARCH_API_KEY` credential reference, and the `anysearch-search/account` credential record are unchanged, so settings, keys, and the stored account carry over.

When a Desktop profile starts after the upgrade, built-in plugin reconciliation removes the owned `dsh-bundle-anysearch-search` package and installs and enables `anysearch-search`. Because the ledger tracks plugins by package name, a profile that had removed the old package receives the renamed one as a new plugin.

## Migration

1. Rename the checkout beside this repository from `dsh-bundle-anysearch-search` to `anysearch-search` before preparing a Desktop build; preparation fails while the listed checkout is absent.
2. Start Desktop once for each profile that used the bundled plugin. No package installation is needed.
3. If you had removed the old plugin and want to keep AnySearch off, remove `anysearch-search` on the Plugins page after the first launch.
4. Confirm the profile's `package.json` lists `anysearch-search` in `dependencies` and `dsh.profile.bundles`, does not list `dsh-bundle-anysearch-search`, and the Plugins page shows AnySearch enabled.

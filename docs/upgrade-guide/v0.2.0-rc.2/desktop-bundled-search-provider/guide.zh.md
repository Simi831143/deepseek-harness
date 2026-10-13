---
kind: upgrade-guide
description: "Desktop 不再随包提供 Exa 搜索插件，改为随包提供 AnySearch 搜索插件。"
---

# Desktop 随包搜索提供方变更

[English](guide.md) | 中文

## 变更

此变更之前的 Desktop 构建随包提供 `dsh-bundle-exa-search`，它注册 `exa` 搜索提供方和 `exa-search` 设置行。新构建随包提供 `dsh-bundle-anysearch-search`，改为注册 `anysearch` 提供方和 `anysearch-search` 设置行。

Desktop profile 升级后首次启动时，内置插件协调会移除由 Desktop 所有的 Exa 包及 bundle 条目，再安装并启用 AnySearch。用户独立安装的同名包不属于 Desktop 所有范围，会保持不变。已有 profile 配置文件仍保留在磁盘上，但 Exa 专用设置行和 `searchProvider: exa` 不再选择随包提供方。

## 迁移

1. 对每个使用内置搜索插件的 profile 启动一次 Desktop。启动流程会移除由 Desktop 所有的 `dsh-bundle-exa-search` 条目，并加入 `dsh-bundle-anysearch-search`，不需要运行包安装。
2. 如果 profile 或 overlay 明确设置了 `searchProvider: exa`，将其改为 `searchProvider: anysearch`。把针对 `exa-search` 行的设置覆盖改到 `anysearch-search` 行；匿名访问不够用时，配置 AnySearch 密钥。
3. 确认 profile 的 `package.json` 在 `dependencies` 和 `dsh.profile.bundles` 中列出 `dsh-bundle-anysearch-search`，不再列出由 Desktop 所有的 Exa 包，并确认 Plugins 页面显示 AnySearch 已启用。

---
kind: upgrade-guide
description: "Desktop 随包提供的 AnySearch 插件包从 `dsh-bundle-anysearch-search` 改名为 `anysearch-search`。"
---

# Desktop 随包提供的 AnySearch 插件改名为 `anysearch-search`

[English](guide.md) | 中文

## 变更

此变更之前的 Desktop 构建以 `dsh-bundle-anysearch-search` 包随包提供 AnySearch 搜索插件，从本仓库旁的同名检出目录构建。新构建改为以 `anysearch-search` 包提供，检出目录名为 `anysearch-search`。插件页显示它的本地化标题，不再显示包名。

`anysearch` 提供方 id、`anysearch-search` 设置行、`ANYSEARCH_API_KEY` 凭据引用和 `anysearch-search/account` 凭据记录保持不变，因此设置、密钥和已存账号都会保留。

Desktop profile 升级后首次启动时，内置插件协调会移除由 Desktop 所有的 `dsh-bundle-anysearch-search` 包，再安装并启用 `anysearch-search`。由于记录按包名跟踪插件，曾经移除旧包的 profile 会把改名后的包当作新插件接收。

## 迁移

1. 准备 Desktop 构建之前，把本仓库旁的检出目录从 `dsh-bundle-anysearch-search` 改名为 `anysearch-search`；列出的检出目录缺失时准备阶段失败。
2. 对每个使用随包插件的 profile 启动一次 Desktop，不需要运行包安装。
3. 如果之前移除过旧插件且仍不想启用 AnySearch，首次启动后在插件页移除 `anysearch-search`。
4. 确认 profile 的 `package.json` 在 `dependencies` 和 `dsh.profile.bundles` 中列出 `anysearch-search`，不再列出 `dsh-bundle-anysearch-search`，并且插件页显示 AnySearch 已启用。

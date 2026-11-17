---
kind: upgrade-guide
description: "可选市场 bundle 将独立插件市场配置行替换为共享市场上的插件适配器。"
---

# 插件发现接入共享市场

[English](guide.md) | 中文

## 变更

可选的 `@deepseek-ai/dsh-market-bundle` 将插件放在市场的第四个页签。原有 `lc-plugin-market` 和 `lc-ui-plugin-market` 配置行由 `market-plugins` 替代，使用现有 `market` 配置行的目录 URL。bundle 不再挂载第二个目录读取服务，也不再向插件页面提供发现页签。插件页面继续管理已安装插件的启用、配置和运行状态。

安装需要成功重新验证目录。目录请求失败时可以保留此前目录的展示，但会阻止从该目录发起新安装。

## 迁移

1. 在 profile 的 `cordis.patch.yml` 或部署覆盖文件中，移除针对 `lc-plugin-market` 或 `lc-ui-plugin-market` 的覆盖。将目录地址设置在 `market` 配置行的 `config.catalogUrl`，替代 `lc-plugin-market` 的 `config.indexes`。
2. 挂载 `market-plugins` 时保持 profile 的插件管理器可用。现有插件依赖以及已安装技能和连接器文件保留在当前位置。
3. 重启应用，打开市场，确认专家、技能、连接器和插件四个页签出现。从插件页签安装市场插件，在应用的插件页面管理其配置。

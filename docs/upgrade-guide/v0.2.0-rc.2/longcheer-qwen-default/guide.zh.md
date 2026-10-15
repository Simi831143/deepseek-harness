---
kind: upgrade-guide
description: "内置 Longcheer 模型目录现在只包含支持图片输入的 qwen3.8-plus，并使用更大的上下文与输出上限。"
---

# 内置 Longcheer 目录现在使用 `qwen3.8-plus`

[English](guide.md) | 中文

## 变更

内置的 `longcheer` 提供方之前公布多个网关模型 id。现在它只公布 `qwen3.8-plus`，支持文本和图片输入，上下文窗口为 1,000,000 个 token，输出上限为 256,000 个 token。已经定义 `llm-pi-ai` 的 profile patch 会保留自己的模型目录，因为后置 profile 层会替换 bundle 行的完整配置。

## 迁移

1. 如果 Desktop 或 Web profile 正在使用已移除的内置模型 id，请在模型设置中选择 `qwen3.8-plus`，或编辑该 profile 的 `cordis.patch.yml`，写入完整的 `llm-pi-ai` 配置，并在 `providers.longcheer` 中保留网关需要的 `api`、`baseURL`、`apiKeyEnv` 和 `models` 字段；该 patch 会替换 bundle 行的完整配置，不会做深合并。
2. 如果你维护自定义 Longcheer 目录，请保留与网关一致的模型字段：视觉模型使用 `contextWindow`、`maxTokens` 和 `input: [text, image]`。
3. 发送一条带图片的测试消息，确认模型选择器显示 `qwen3.8-plus`，并且 Longcheer 网关接受请求。

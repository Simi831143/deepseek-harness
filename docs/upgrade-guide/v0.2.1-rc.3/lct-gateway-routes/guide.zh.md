---
kind: upgrade-guide
description: "内置的 longcheer 提供方由 lct-openai 和 lct-anthropic 两个网关路由取代，默认模型改为 lct-anthropic/qwen3.6-max。"
---

# 内置网关路由现在是 `lct-openai` 和 `lct-anthropic`

[English](guide.md) | 中文

## 变更

base bundle 之前定义一个 `llm-pi-ai` 提供方 `longcheer`，只有 `qwen3.8-plus` 一个模型，`agent-default-model` 选择 `longcheer/qwen3.8-plus`。现在它为同一个网关定义两个提供方，两者都读取 `LONGCHEER_API_KEY`：

| 提供方 | `api` | `baseURL` | 模型 |
|---|---|---|---|
| `lct-openai` | `openai-responses` | `http://172.16.92.211:23323/v1` | `qwen3.8-plus-openai`、`DeepSeek-V4.1-Flash-openai` |
| `lct-anthropic` | `anthropic-messages` | `http://172.16.92.211:23323` | `qwen3.6-max`、`DeepSeek-V4.1-Flash`、`qwen3.8-plus` |

每个模型都声明 262,144 token 的 `contextWindow`、65,536 token 的 `maxTokens` 和 `input: [text, image]`。默认模型是 `lct-anthropic/qwen3.6-max`。bundle 中不再有 `longcheer` 提供方 id。

受影响的读者：已保存的默认模型或会话路由指向 `longcheer` 的 profile，以及定义了 `llm-pi-ai` 或 `agent-default-model` 的 profile patch。profile patch 行会完整替换 bundle 行，因此这类 profile 保留自己的提供方和默认模型。

## 迁移

1. 如果模型选择器对已有会话或已保存的默认模型显示不出模型，请在模型设置中选择一个 `lct-anthropic` 或 `lct-openai` 模型。已保存的 `longcheer/...` 默认值位于 profile 的 `cordis.patch.yml` 中的 `agent-default-model` 行；删除该行即可使用内置默认模型。
2. 如果 profile 的 `cordis.patch.yml` 定义 `llm-pi-ai` 只是为了访问这个网关，请删除该行，让内置路由生效。如果保留自定义行，请让 `maxTokens` 小于 `contextWindow`：网关会拒绝输入加 `maxTokens` 超出窗口的请求，压缩也会从窗口中预留 `maxTokens`。
3. 确认模型选择器列出两个提供方，然后向 `lct-anthropic/qwen3.6-max` 发送一条带图片的测试消息。

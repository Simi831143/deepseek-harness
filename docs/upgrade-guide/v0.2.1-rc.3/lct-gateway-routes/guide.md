---
kind: upgrade-guide
description: "The bundled longcheer provider is replaced by the lct-openai and lct-anthropic gateway routes, and the default model becomes lct-anthropic/qwen3.6-max."
---

# The bundled gateway routes are now `lct-openai` and `lct-anthropic`

English | [中文](guide.zh.md)

## Change

The base bundle previously defined one `llm-pi-ai` provider, `longcheer`, with the single model `qwen3.8-plus`, and `agent-default-model` selected `longcheer/qwen3.8-plus`. It now defines two providers for the same gateway, and both read `LONGCHEER_API_KEY`:

| Provider | `api` | `baseURL` | Models |
|---|---|---|---|
| `lct-openai` | `openai-responses` | `http://172.16.92.211:23323/v1` | `qwen3.8-plus-openai`, `DeepSeek-V4.1-Flash-openai` |
| `lct-anthropic` | `anthropic-messages` | `http://172.16.92.211:23323` | `qwen3.6-max`, `DeepSeek-V4.1-Flash`, `qwen3.8-plus` |

Every model declares a 262,144-token `contextWindow`, a 65,536-token `maxTokens`, and `input: [text, image]`. The default model is `lct-anthropic/qwen3.6-max`. The `longcheer` provider id no longer exists in the bundle.

Affected readers: profiles whose saved default or Session route names `longcheer`, and profile patches that define `llm-pi-ai` or `agent-default-model`. A profile patch row replaces the bundle row completely, so such a profile keeps its own providers and default.

## Migration

1. If the model selector shows no model for an existing Session or for the saved default, select a `lct-anthropic` or `lct-openai` model in the model settings. A saved `longcheer/...` default lives in the `agent-default-model` row of the profile's `cordis.patch.yml`; delete that row to use the bundled default.
2. If the profile's `cordis.patch.yml` defines `llm-pi-ai` only to reach this gateway, delete that row so the bundled routes apply. If you keep a custom row, keep `maxTokens` below `contextWindow`: the gateway rejects a request whose input plus `maxTokens` exceeds the window, and compaction reserves `maxTokens` of the window.
3. Confirm that the model selector lists both providers, then send a test prompt with an image to `lct-anthropic/qwen3.6-max`.

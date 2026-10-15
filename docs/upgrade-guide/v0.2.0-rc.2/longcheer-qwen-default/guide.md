---
kind: upgrade-guide
description: "The bundled Longcheer model catalog now contains only qwen3.8-plus with image input and larger context and output limits."
---

# The bundled Longcheer catalog now uses `qwen3.8-plus`

English | [中文](guide.zh.md)

## Change

The bundled `longcheer` provider previously exposed a catalog of multiple gateway model ids. It now exposes only `qwen3.8-plus`, with text and image input, a 1,000,000-token context window, and a 256,000-token output limit. A profile patch that already defines `llm-pi-ai` keeps its own model catalog because later profile layers replace the bundle row.

## Migration

1. If your Desktop or Web profile uses one of the removed bundled model ids, open the model settings and select `qwen3.8-plus`, or edit that profile's `cordis.patch.yml` with a complete `llm-pi-ai` configuration whose `providers.longcheer` includes the gateway's `api`, `baseURL`, `apiKeyEnv`, and `models` entries; the patch replaces the bundle row instead of deep-merging it.
2. If you maintain a custom Longcheer catalog, keep the model fields that match the gateway: `contextWindow`, `maxTokens`, and `input: [text, image]` for a vision-capable model.
3. Send a test prompt with an image and confirm that the model selector shows `qwen3.8-plus` and the request is accepted by the Longcheer gateway.

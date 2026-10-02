---
description: "Replace the browser account round trip with Feishu OAuth sign-in."
kind: "package-bundle"
---

# @deepseek-ai/dsh-account-feishu

English | [中文](README.zh.md)

## Summary

This bundle replaces the DeepSeek Platform account with a Feishu account that only names the user. It switches off the Platform account provider, its account UI, and the account-token model route, then inserts a Feishu OAuth provider and the Feishu account UI. Models keep their own API keys, so a fresh installation uses the bundled default model whether or not anyone signs in. The provider stores the Feishu `union_id` as the account identity and keeps the app secret in the Host environment rather than the profile.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Sign in from the sidebar account launcher or the Settings **Account** page by scanning the Feishu QR code; the same places switch accounts and sign out. Desktop supplies `FEISHU_APP_SECRET` and `LONGCHEER_API_KEY` from its deployment environment; neither value is written to the profile. A Web deployment must provide the same variables to the Host process before starting the profile. The base composition keeps `longcheer/qwen3.8-plus` as the default model.

For a Windows package, place both values in the repository-root `.secrets.env` file and run `pnpm run package:desktop:win:x64:unsigned` with the Electron mirror configured. The packager copies only these two names to `deployment-env.json`; the Desktop main process injects them into the Host on every launch.

The callback uses `http://127.0.0.1:19387/feishu/callback` on Desktop. Web uses the loopback origin supplied by the client. Desktop opens the authorization page in an in-app window with a fresh browser session for every attempt, so Feishu always shows its QR login and a switch can reach another account. The Settings page keeps copy-link and open-link fallbacks while an attempt waits.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`cordis.patch.yml` disables `deepseek-account`, `ui-settings-account`, and `llm-deepseek-account`, then inserts `feishu-account` and `ui-account-feishu`. The disabled model route would otherwise list a "DeepSeek Account" provider that the Feishu account can never authenticate. `package.json` declares both inserted packages so the rows resolve from this bundle, while the app profile selects this bundle as its final layer.

The provider uses PKCE, requests `offline_access contact:user.email:readonly`, refreshes tokens before expiry, and persists the account identity and refresh grant through the credentials service. The provider returns no model token, wallet links, balance, or platform session.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Disables the upstream account and account-model rows and inserts the Feishu rows |
| [`package.json`](package.json) | Declares the bundle patch and its row packages |
| [`src/index.ts`](src/index.ts) | Empty module entry; the patch is the runtime content |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [feishu-account](../../credentials/feishu-account/README.md) — the OAuth provider and stored grant behavior.
- [ui-account-feishu](../../client/ui-account-feishu/README.md) — the sidebar launcher, the Settings page, and the sign-in interaction.
- [base bundle](../base/README.md) — the layer contributing `deepseek-account`.
- [web bundle](../web-app/README.md) — the layer contributing `ui-settings-account`.

-----

<a id="model-experience"></a>
## Model Experience

### Account-only composition

#### What the model sees

Nothing. This bundle replaces account sign-in and does not add prompt text, tools, model inputs, or `Session` events.

#### Token effect

None. The bundle does not issue or resolve inference credentials.

#### KV Cache effect

None; this package neither assembles nor sends model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The Feishu issuer must be reachable during sign-in.** Existing sessions continue to use the stored grant until it needs refreshing.
- **Deployment secrets remain deployment-sensitive.** Missing `FEISHU_APP_SECRET` makes sign-in fail before any QR code appears, and the account UI reports that this build cannot sign in; missing `LONGCHEER_API_KEY` makes the default Longcheer model request fail. The Host still starts, and neither secret is copied into profile `.env`.
- **The provider is not a model credential provider.** `resolveToken()` intentionally returns no inference token.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>

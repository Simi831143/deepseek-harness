---
description: "Host Feishu OAuth provider with PKCE, refresh, and durable account identity."
kind: "package-reference"
---

# @deepseek-ai/dsh-feishu-account

English | [中文](README.zh.md)

## Summary

The Host-only provider implements the shared account contract with Feishu OAuth and PKCE. It stores the Feishu `union_id`, `open_id`, display fields, and refresh grant through the credentials service, while reading the app secret from a named Host environment variable.

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

Use the `feishu-account` row from `@deepseek-ai/dsh-account-feishu`. Configure `appId`, `appSecretRef`, and `scope`; the default secret reference is `FEISHU_APP_SECRET`. The provider starts its loopback callback listener only during an explicit sign-in attempt.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The provider validates callback origins, performs the authorization-code exchange with PKCE, reads user information, and stores refresh-token rotation results. A new sign-in while a grant is stored is an account switch: the existing grant stays in place until the new one commits, and a cancelled or failed attempt leaves it untouched. It refreshes grants when less than five minutes remain, merges concurrent in-process refreshes, and checks the stored token again before deleting an expired grant. The callback and attempt lifecycle are disposed with the Host service.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Account service, callback lifecycle, grant persistence, and refresh behavior |
| [`src/protocol.ts`](src/protocol.ts) | Feishu HTTP schemas, endpoint calls, timeout and error mapping |
| [`src/types.ts`](src/types.ts) | Provider configuration type |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [account-feishu bundle](../../bundle/account-feishu/README.md) — the profile rows that mount this provider.
- [authorization](../authorization/README.md) — shared browser authorization lifecycle.
- [deepseek-account](../deepseek-account/README.md) — the account contract implemented by this provider.

-----

<a id="model-experience"></a>
## Model Experience

### Account identity only

#### What the model sees

Nothing. `resolveToken()` intentionally returns no model credential; this provider supplies account identity and sign-in state only.

#### Token effect

None. Feishu access and refresh grants authenticate the account flow, not model inference.

#### KV Cache effect

None; the provider does not assemble model prompts or inference requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Feishu authorization is required again when the grant expires or the app identity changes.** The provider removes a stale or mismatched grant instead of silently accepting it.
- **A missing deployment secret fails sign-in before the authorization page.** The attempt fails with `protocol` and publishes no authorization URL, so no user scans a code the exchange could never redeem; the Host logs the missing reference name. Host startup remains available so the account UI can report the configuration problem.
- **The provider requires the shared Host web server during sign-in.** It does not open a callback listener outside an active authorization attempt.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>

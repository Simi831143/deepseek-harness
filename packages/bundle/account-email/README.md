---
description: "Replace the browser account round trip with email one-time-code sign-in."
kind: "package-bundle"
---

# @deepseek-ai/dsh-account-email

English | [中文](README.zh.md)

## Summary

This bundle switches off the two rows that implement the browser account round trip — `deepseek-account` and `ui-settings-account` — and inserts the three rows that replace them: the account provider answering the same contract from a stored email grant, the Remote controller owning the two sign-in steps, and the Settings card that drives them. Losing the switched-off card's balance and top-up entries is intended: this deployment has no wallet.

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

Open **Settings** and select **Email sign-in**. The address field, the code field, the resend countdown, and the stored identity behave as [`ui-account-email`](../../client/ui-account-email/README.md) describes. The rows this bundle switches off leave no trace in the panel: the browser-flow card, its sidebar launcher, and its onboarding surface are absent rather than disabled in place. Because the bundle is part of the profile's layer list from the first launch, no operator action selects it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`cordis.patch.yml` disables the two upstream rows by id and inserts its own three, so the composed profile changes without any upstream file changing: `id` + `disabled` edits a row another layer contributed, and a new row must arrive inside `insert` — a bare `id` naming a row that does not exist yet is silently ignored. The layer order is what makes this work: the base bundle contributes `deepseek-account` and the Web bundle contributes `ui-settings-account`, and both patch before this one.

`package.json` depends on the two packages its rows name, so each row resolves from this bundle, and `apps/cli` depends on this bundle so it enters the installation's runtime closure. `apps/desktop/src/project-manager.ts` lists it in the Desktop profile's bundle layer list.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Switches `deepseek-account` and `ui-settings-account` off; inserts `email-code-account`, `email-login-controller`, and `ui-account-email` |
| [`package.json`](package.json) | The row packages as dependencies, plus the profile layer declaration |
| [`locale/en.json`](locale/en.json), [`locale/zh.json`](locale/zh.json) | Plugin-manager title and description |
| [`icon.svg`](icon.svg) | Plugin-manager icon |
| [`src/index.ts`](src/index.ts) | Empty module entry; the patch is the runtime content |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [email-code-account](../../credentials/email-code-account/README.md) — the provider, the issuer adapter, and the `emailLogin` Remote namespace the card calls.
- [ui-account-email](../../client/ui-account-email/README.md) — the Settings card this bundle mounts.
- [base bundle](../base/README.md) — the layer contributing `deepseek-account`.
- [web bundle](../web-app/README.md) — the layer contributing `ui-settings-account`.

-----

<a id="model-experience"></a>
## Model Experience

None, as the bundle replaces a sign-in surface and leaves the model path untouched: the provider resolves no inference credential, so `llm-deepseek` and its key keep serving requests exactly as before.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The issuer must be reachable to sign in.** Signing in is the only step that talks to it; every read afterwards is served from the stored grant.
- **Switching a row off by id is order-dependent.** The two disabled rows must already exist when this layer applies. A profile that selects this bundle without the base or Web bundle logs `patch: entry <id> not found` for each missing row and keeps the browser-flow card.
- **Runtime invariant:** No companion is published because the bundle owns no mutable runtime state; its whole content is the two patch entries and the three inserted rows.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>

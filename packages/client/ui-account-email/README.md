---
description: "The email one-time-code sign-in card on the dsh web client's Settings page."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-account-email

English | [中文](README.zh.md)

## Summary

Open **Settings** in the sidebar and select **Email sign-in** to sign in with a one-time code mailed to an address. The card collects the address, asks the Host to have the issuer mail a code, holds its resend control for a minute, exchanges the code for the stored login, and then shows the identity that login proved with a **Sign out** action. Every failure reads the same way: the card never reports whether an address is unknown, a code expired, or the issuer was unreachable.

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

Type an address and press **Send code**; the button is disabled until the field holds something that could be mailed to. After the issuer accepts the request the button becomes a countdown (`Resend in 60s`) and releases itself after the minute. Type the code from the mail and press **Sign in**: the Host stores the login and the card flips to the identity line — the name the issuer reported, or the address when it reported none — plus **Sign out**. Signing out removes the stored login only; the issuer exposes no revocation endpoint, and nothing on disk is deleted.

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half binds its `settings.accountEmail` dictionary and registers `EmailLoginCard` into the `settings.section` list slot at `id: 'email-login'`, `order: -9`, so it takes the seat the browser round trip's card leaves empty.

The card owns the interaction; the account contract's attempt state machine does not model a typed code, so `attempt` stays `null` and the card drives the two steps itself through `ctx.remote.emailLogin`. It observes the shared `account` namespace instead of keeping its own session: `ctx.remote.account.watch` reports whether a credential is stored, and `getProfile` supplies the display identity the Host already proved — no issuer request follows a sign-in. Signing out goes through `ctx.remote.account.signOut`, the same seam the browser-flow card used.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings](../ui-settings/README.md) — the settings shell and the `settings.section` list slot the card registers into.
- [email-code-account](../../credentials/email-code-account/README.md) — the provider, the `emailLogin` Remote namespace, and the issuer backend the card calls.
- [account-email](../../bundle/account-email/README.md) — the bundle that switches the browser-flow rows off and mounts this card.
- [ui-primitives](../ui-primitives/README.md) — the button and input atoms the card renders.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Sign-out is local.** The issuer has no revocation endpoint, so signing out deletes the stored grant and nothing else; a token already copied out of the store stays valid until it expires.
- **One failure message.** The card reports every refusal with one string, so an operator diagnosing a deployment reads the Host log rather than the page.
- **Runtime invariant:** No companion is published. The card owns no store of its own: what it shows derives from the account stream and the profile read, and what it sends the Host validates.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

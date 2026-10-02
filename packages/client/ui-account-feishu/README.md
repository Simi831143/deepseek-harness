---
description: "Feishu account launcher and Settings page: QR sign-in, identity, account switch, and sign-out."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-account-feishu

English | [中文](README.zh.md)

## Summary

The Feishu account UI shows the signed-in user's avatar and name in the sidebar account launcher and on the Settings **Account** page. From either place a user signs in by scanning a Feishu QR code, switches to another Feishu account, or signs out. The account only names the user: models keep their own API keys on the Models page, and signing out leaves them untouched.

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

Load the package through `@deepseek-ai/dsh-account-feishu`; it is a Client plugin rather than a standalone application entry. The bundle supplies the provider row and disables the upstream account UI before these components register.

Signed out, the sidebar launcher offers **Settings** and **Sign in with Feishu**. Signed in, it shows the avatar and name and offers **Settings**, **Switch account**, and **Sign out**. Desktop opens the Feishu QR page in its own sign-in window; a waiting attempt also offers open-link, copy-link, and cancel actions on the Settings page. Switching keeps the current account until the new sign-in commits, so a cancelled switch changes nothing. Sign-out asks for confirmation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

One store per client follows the shared `account` Remote stream, reads the profile once per stored grant and again after a completed sign-in, and exposes the sign-in, cancel, and sign-out operations. The `settings.launcher` and `settings.section` registrations inject the same store, so both surfaces show one state. The served Web app passes its page origin as the OAuth callback origin. Desktop serves the page from its `dsh-app:` scheme, so the store passes the Host loopback origin that the shell publishes as `__DSH_TRANSPORT__.streamBaseUrl`, with the `desktop` login source. A `protocol` failure published before any authorization URL means this build has no Feishu app secret, and the UI says so instead of asking the user to retry. The Host face exports an empty `apply` so the Loader mounts the row and the client module system serves its browser half.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host face mounted by the Loader |
| [`src/client/index.ts`](src/client/index.ts) | Client plugin, account stream, and slot registrations |
| [`src/client/account-store.ts`](src/client/account-store.ts) | Account state, profile reads, callback origin, and operations |
| [`src/client/FeishuAccountMenu.tsx`](src/client/FeishuAccountMenu.tsx) | Sidebar launcher and its menu |
| [`src/client/FeishuAccountSection.tsx`](src/client/FeishuAccountSection.tsx) | Settings account page |
| [`src/client/attempt-status.tsx`](src/client/attempt-status.tsx) | Shared attempt guidance, link fallbacks, and failure copy |
| [`src/client/locales.ts`](src/client/locales.ts) | English and Chinese copy |
| [`tsdown.config.ts`](tsdown.config.ts) | Client bundle entry configuration |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [account-feishu bundle](../../bundle/account-feishu/README.md) — profile patch and package composition.
- [feishu-account](../../credentials/feishu-account/README.md) — Host OAuth and credential behavior.
- [Settings slots](../../../docs/subsystems/slots.md) — the slot lifecycle used by the launcher and the page.

-----

<a id="model-experience"></a>
## Model Experience

### Account UI only

#### What the model sees

Nothing. This package changes user-facing account surfaces and adds no prompts, tools, model inputs, or `Session` events.

#### Token effect

None. The UI neither reads nor provides model credentials.

#### KV Cache effect

None; the package does not participate in model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Web browsers control the authorization page.** The served Web app hands the page to the browser; a browser already signed in to Feishu web shows an authorize button instead of the QR code.
- **The UI depends on the shared account Remote.** Loading it without the account Remote leaves the registrations unable to resolve their required service.
- **No runtime invariant companion is published.** The UI owns no durable relation; the provider and slot registry own the state it observes.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>

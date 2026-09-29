---
description: "Email one-time-code sign-in: the seam an issuer backend implements, and the cam-auto-platform backend this build ships."
kind: "package-reference"
---

# @deepseek-ai/dsh-email-code-account

English | [中文](README.zh.md)

This package holds the backend seam for email one-time-code sign-in. Everything above the seam — the account provider, the stored credential, the sign-in form — is issuer-agnostic; everything below it is one company's HTTP shape. Replacing the issuer means implementing `EmailCodeBackend` once more and pointing the composition at that implementation.

`requestCode` asks the issuer to mail a code to an address and returns once the issuer accepted the request, not once the mail arrived. `verifyCode` exchanges the code the user read for a credential and the identity it belongs to. Both take the caller's `AbortSignal`, so the caller owns retry policy and no timer outlives its call.

`EmailCodeError.kind` separates what a caller can act on: `network` when the issuer could not be reached or the deadline passed, `rejected` when the issuer answered and refused, and `invalid-response` when the answer cannot be used. The provider maps those onto the account layer's sign-in error codes; no issuer text reaches the UI verbatim.

## Summary

Sign in with an email one-time code through a replaceable issuer backend. The account provider and the sign-in form depend on the seam only.

The shipped `createCamAutoPlatformBackend` calls the platform's `/users/send-verification-code` and `/users/verify-code-login` endpoints, and reports failure from inside the platform's `{ code, success, data, message, errors }` envelope, because a 2xx alone is not success there.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Configure `baseUrl` and `requestTimeoutMs` for the deployment, then hand the backend to the account provider. The base URL is an origin without a trailing slash; the backend normalises a trailing slash so a configured `http://host:8081/` and `http://host:8081` address the same endpoints.

The platform's login type is fixed at 2 (sign in), which also creates the account when the address is unknown — the issuer's own behaviour, so this package needs no registration step.

`verifyCode` reads the claims of the returned token to recover the display identity and the expiry. It does not verify the signature: the issuer is the only party that validates its own token, and the claims travel into the credential snapshot for display, never as proof of authorization.

<a id="understand-the-implementation"></a>
## Understand the implementation

The seam is two methods, one result type, and one error class, so a second issuer costs one file and one configuration value. The provider composes this package through `EmailCodeBackend` and never imports the platform backend directly, which is what keeps the swap honest.

<a id="further-exploration"></a>
## Further Exploration

The [credentials subsystem](../../../docs/subsystems/credentials.md) owns credential storage; the [architecture](../../../docs/architecture.md) explains application composition.

<a id="model-experience"></a>
## Model Experience

None, as the credential this package returns is presented to the account layer for display and is never sent to a model.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The shipped backend targets one deployment and reads one response envelope. A second issuer that reshapes either is a new file, not a configuration change.
- The platform reports every refusal as one message, so `rejected` carries no finer reason; a caller cannot distinguish a wrong code from an expired one.
- The token has no refresh flow: expiry is recorded from the token's own claim and nothing renews it.
- **Runtime invariant:** No runtime invariant companion is published because this package owns no mutable runtime state; the grant it produces is written to the credential store, whose shape the Host validates on every read.

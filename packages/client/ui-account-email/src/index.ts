/**
 * Email sign-in card, node half. Pure UI plugin: the empty apply exists so the
 * plugin appears in the host cordis.yml / Loader; the browser half ships via
 * exports["./client"], discovered through the package.json dsh.client
 * declaration. The two sign-in steps it calls are served by
 * `@deepseek-ai/dsh-email-code-account`'s Remote controller, which the profile's
 * bundle mounts alongside this row.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}

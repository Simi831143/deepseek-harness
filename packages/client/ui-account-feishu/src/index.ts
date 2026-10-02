/**
 * Host half of the Feishu account UI. It has no Host behavior; the empty apply
 * exists so the Loader mounts this row and the client module system serves the
 * browser half declared through `dsh.client`.
 */

/** Host plugin body — no Host-side behavior for this surface plugin. */
export function apply(): void {}

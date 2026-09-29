/** Deployment choices for email-code sign-in. */

import Schema from '@deepseek-ai/schemastery'

/** Validated deployment choices; every field is overridable from the profile patch layer. */
export const Config = Schema.object({
  /** Issuer backend this build talks to. A new issuer adds one value here and one backend module. */
  backend: Schema.union(['cam-auto-platform']).default('cam-auto-platform'),
  /** HTTP origin of the issuer, without a trailing slash, e.g. `http://172.24.126.100:8081`. */
  baseUrl: Schema.string().default('http://172.24.126.100:8081'),
  /** Deadline for one issuer request, in milliseconds. */
  requestTimeoutMs: Schema.number().min(1).max(120_000).default(30_000),
  /** Where the sign-in card explains itself; an empty string hides the line. */
  hint: Schema.string().default(''),
})

/** Resolved deployment choices, as every consumer of {@link Config} receives them. */
export type EmailCodeAccountConfig = ReturnType<typeof Config>

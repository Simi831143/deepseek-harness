/** Host configuration for the Feishu account provider. */
export interface FeishuAccountConfig {
  /** Feishu custom application id. */
  appId?: string
  /** Environment variable containing the app secret. */
  appSecretRef?: string
  /** Least-privilege user token scope requested at authorization and refresh. */
  scope?: string
  /** Feishu request deadline in milliseconds. */
  requestTimeoutMs?: number
  /** Maximum duration of one browser authorization attempt. */
  attemptTimeoutMs?: number
  /** Authorization URL, overridable for local tests. */
  authorizeEndpoint?: string
  /** Feishu API origin, overridable for local tests. */
  apiOrigin?: string
}

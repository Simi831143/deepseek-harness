/** Email sign-in copy, owned by the sign-in card. */

/** English email sign-in dictionary. */
export const en = {
  nav: 'Email sign-in',
  title: 'Sign in with an email code',
  description: 'We mail a one-time code to this address. Signing in creates the account when it does not exist yet.',
  emailLabel: 'Email', emailPlaceholder: 'you@example.com',
  codeLabel: 'Verification code', codePlaceholder: 'Code from the mail',
  sendCode: 'Send code', resendIn: 'Resend in {{seconds}}s',
  signIn: 'Sign in', signOut: 'Sign out',
  signedIn: 'Signed in', signedOut: 'Not signed in',
  loading: 'Loading…',
  // One failure message for every cause: the card never reports whether an
  // address is unknown, a code expired, or the issuer was unreachable.
  failed: 'Could not complete the operation. Try again.',
  emailInvalid: 'Enter a valid email address',
} as const

/** Email sign-in locale keys. */
export type AccountEmailKey = keyof typeof en

/** Chinese email sign-in copy. */
export const zh: Record<AccountEmailKey, string> = {
  nav: '邮箱登录',
  title: '使用邮箱验证码登录',
  description: '我们会向该邮箱发送一次性验证码。该邮箱尚未注册时会自动创建账号。',
  emailLabel: '邮箱', emailPlaceholder: 'you@example.com',
  codeLabel: '验证码', codePlaceholder: '邮件中的验证码',
  sendCode: '发送验证码', resendIn: '{{seconds}} 秒后可重发',
  signIn: '登录', signOut: '退出登录',
  signedIn: '已登录', signedOut: '尚未登录',
  loading: '加载中…',
  failed: '操作未完成，请重试。',
  emailInvalid: '请输入有效的邮箱地址',
}

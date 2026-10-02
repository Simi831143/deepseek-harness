/** Feishu account copy shared by the sidebar menu and the Settings page. */
export const en = {
  nav: 'Account', menu: 'Account menu', more: 'More', settings: 'Settings',
  signIn: 'Sign in with Feishu', switchAccount: 'Switch account', signOut: 'Sign out',
  signedOutTitle: 'Not signed in', signedOutDescription: 'Scan the QR code with the Feishu mobile app to sign in. Models are configured separately on the Models page.',
  signedIn: 'Signed in with Feishu', loading: 'Loading…',
  waiting: 'Scan the QR code in the Feishu window with the Feishu mobile app, or open the link below.',
  signingIn: 'Signing in…', open: 'Open the sign-in page', copy: 'Copy sign-in link', copied: 'Link copied',
  cancel: 'Cancel', failed: 'Feishu sign-in did not complete. Try again.', unavailable: 'Feishu sign-in is not available in this build. Contact the administrator.',
  expired: 'The sign-in timed out. Try again.', retry: 'Try again',
  signOutTitle: 'Sign out of Feishu?', signOutDescription: 'Your models, sessions, and settings stay on this device.',
} as const
/** Simplified Chinese copy for the Feishu account UI. */
export const zh = {
  nav: '账号', menu: '账号菜单', more: '更多', settings: '设置',
  signIn: '飞书扫码登录', switchAccount: '切换账号', signOut: '退出登录',
  signedOutTitle: '未登录', signedOutDescription: '用飞书手机端扫码登录。模型在「模型」页单独配置。',
  signedIn: '已使用飞书登录', loading: '加载中…',
  waiting: '请在弹出的飞书窗口中用飞书手机端扫码；窗口未出现时可使用下面的链接。',
  signingIn: '正在登录…', open: '打开登录页', copy: '复制登录链接', copied: '链接已复制',
  cancel: '取消', failed: '飞书登录未完成，请重试。', unavailable: '当前版本未配置飞书登录，请联系管理员。',
  expired: '登录已超时，请重试。', retry: '重试',
  signOutTitle: '退出飞书登录？', signOutDescription: '模型、会话和设置会保留在本机。',
} as const satisfies Record<keyof typeof en, string>
/** Keys shared by the Feishu account locale dictionaries. */
export type FeishuAccountKey = keyof typeof en

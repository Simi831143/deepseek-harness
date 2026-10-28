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
/** Japanese copy for the Feishu account UI. */
export const ja = {
  nav: 'アカウント', menu: 'アカウントメニュー', more: 'その他', settings: '設定',
  signIn: 'Feishu でログイン', switchAccount: 'アカウントを切り替え', signOut: 'ログアウト',
  signedOutTitle: '未ログイン', signedOutDescription: 'Feishu モバイルアプリで QR コードをスキャンしてログインします。モデルは「モデル」ページで別途設定します。',
  signedIn: 'Feishu でログイン済み', loading: '読み込み中…',
  waiting: 'Feishu ウィンドウの QR コードを Feishu モバイルアプリでスキャンするか、下のリンクを開いてください。',
  signingIn: 'ログイン中…', open: 'ログインページを開く', copy: 'ログインリンクをコピー', copied: 'リンクをコピーしました',
  cancel: 'キャンセル', failed: 'Feishu ログインが完了しませんでした。もう一度お試しください。', unavailable: 'このビルドでは Feishu ログインを利用できません。管理者にお問い合わせください。',
  expired: 'ログインがタイムアウトしました。もう一度お試しください。', retry: '再試行',
  signOutTitle: 'Feishu からログアウトしますか？', signOutDescription: 'モデル、セッション、設定はこのデバイスに残ります。',
} as const satisfies Record<keyof typeof en, string>
/** Spanish copy for the Feishu account UI. */
export const es = {
  nav: 'Cuenta', menu: 'Menú de la cuenta', more: 'Más', settings: 'Configuración',
  signIn: 'Iniciar sesión con Feishu', switchAccount: 'Cambiar de cuenta', signOut: 'Cerrar sesión',
  signedOutTitle: 'Sesión no iniciada', signedOutDescription: 'Escanee el código QR con la app móvil de Feishu para iniciar sesión. Los modelos se configuran por separado en la página Modelos.',
  signedIn: 'Sesión iniciada con Feishu', loading: 'Cargando…',
  waiting: 'Escanee el código QR de la ventana de Feishu con la app móvil de Feishu o abra el enlace de abajo.',
  signingIn: 'Iniciando sesión…', open: 'Abrir la página de inicio de sesión', copy: 'Copiar enlace de inicio de sesión', copied: 'Enlace copiado',
  cancel: 'Cancelar', failed: 'No se completó el inicio de sesión con Feishu. Inténtelo de nuevo.', unavailable: 'El inicio de sesión con Feishu no está disponible en esta versión. Póngase en contacto con el administrador.',
  expired: 'Se agotó el tiempo para iniciar sesión. Inténtelo de nuevo.', retry: 'Reintentar',
  signOutTitle: '¿Cerrar sesión de Feishu?', signOutDescription: 'Sus modelos, sesiones y configuración se conservan en este dispositivo.',
} as const satisfies Record<keyof typeof en, string>
/** French copy for the Feishu account UI. */
export const fr = {
  nav: 'Compte', menu: 'Menu du compte', more: 'Plus', settings: 'Paramètres',
  signIn: 'Se connecter avec Feishu', switchAccount: 'Changer de compte', signOut: 'Se déconnecter',
  signedOutTitle: 'Non connecté', signedOutDescription: 'Scannez le code QR avec l’application mobile Feishu pour vous connecter. Les modèles se configurent séparément dans la page Modèles.',
  signedIn: 'Connecté avec Feishu', loading: 'Chargement…',
  waiting: 'Scannez le code QR de la fenêtre Feishu avec l’application mobile Feishu, ou ouvrez le lien ci-dessous.',
  signingIn: 'Connexion…', open: 'Ouvrir la page de connexion', copy: 'Copier le lien de connexion', copied: 'Lien copié',
  cancel: 'Annuler', failed: 'La connexion Feishu n’a pas abouti. Réessayez.', unavailable: 'La connexion Feishu n’est pas disponible dans cette version. Contactez l’administrateur.',
  expired: 'La connexion a expiré. Réessayez.', retry: 'Réessayer',
  signOutTitle: 'Se déconnecter de Feishu ?', signOutDescription: 'Vos modèles, sessions et paramètres restent sur cet appareil.',
} as const satisfies Record<keyof typeof en, string>
/** German copy for the Feishu account UI. */
export const de = {
  nav: 'Konto', menu: 'Kontomenü', more: 'Mehr', settings: 'Einstellungen',
  signIn: 'Mit Feishu anmelden', switchAccount: 'Konto wechseln', signOut: 'Abmelden',
  signedOutTitle: 'Nicht angemeldet', signedOutDescription: 'Scannen Sie den QR-Code mit der mobilen Feishu-App, um sich anzumelden. Modelle werden separat auf der Seite „Modelle“ eingerichtet.',
  signedIn: 'Mit Feishu angemeldet', loading: 'Wird geladen…',
  waiting: 'Scannen Sie den QR-Code im Feishu-Fenster mit der mobilen Feishu-App oder öffnen Sie den Link unten.',
  signingIn: 'Anmeldung läuft…', open: 'Anmeldeseite öffnen', copy: 'Anmeldelink kopieren', copied: 'Link kopiert',
  cancel: 'Abbrechen', failed: 'Die Feishu-Anmeldung wurde nicht abgeschlossen. Versuchen Sie es erneut.', unavailable: 'Die Feishu-Anmeldung ist in diesem Build nicht verfügbar. Wenden Sie sich an den Administrator.',
  expired: 'Die Anmeldung ist abgelaufen. Versuchen Sie es erneut.', retry: 'Erneut versuchen',
  signOutTitle: 'Von Feishu abmelden?', signOutDescription: 'Ihre Modelle, Sitzungen und Einstellungen bleiben auf diesem Gerät.',
} as const satisfies Record<keyof typeof en, string>
/** Russian copy for the Feishu account UI. */
export const ru = {
  nav: 'Аккаунт', menu: 'Меню аккаунта', more: 'Ещё', settings: 'Настройки',
  signIn: 'Войти через Feishu', switchAccount: 'Сменить аккаунт', signOut: 'Выйти',
  signedOutTitle: 'Вход не выполнен', signedOutDescription: 'Отсканируйте QR-код в мобильном приложении Feishu, чтобы войти. Модели настраиваются отдельно на странице «Модели».',
  signedIn: 'Выполнен вход через Feishu', loading: 'Загрузка…',
  waiting: 'Отсканируйте QR-код в окне Feishu мобильным приложением Feishu или откройте ссылку ниже.',
  signingIn: 'Выполняется вход…', open: 'Открыть страницу входа', copy: 'Копировать ссылку для входа', copied: 'Ссылка скопирована',
  cancel: 'Отмена', failed: 'Вход через Feishu не завершён. Попробуйте ещё раз.', unavailable: 'Вход через Feishu недоступен в этой сборке. Обратитесь к администратору.',
  expired: 'Время ожидания входа истекло. Попробуйте ещё раз.', retry: 'Повторить',
  signOutTitle: 'Выйти из Feishu?', signOutDescription: 'Ваши модели, сеансы и настройки останутся на этом устройстве.',
} as const satisfies Record<keyof typeof en, string>
/** Brazilian Portuguese copy for the Feishu account UI. */
export const pt = {
  nav: 'Conta', menu: 'Menu da conta', more: 'Mais', settings: 'Configurações',
  signIn: 'Entrar com o Feishu', switchAccount: 'Trocar de conta', signOut: 'Sair',
  signedOutTitle: 'Não conectado', signedOutDescription: 'Escaneie o QR code com o app Feishu no celular para entrar. Os modelos são configurados separadamente na página Modelos.',
  signedIn: 'Conectado com o Feishu', loading: 'Carregando…',
  waiting: 'Escaneie o QR code da janela do Feishu com o app Feishu no celular ou abra o link abaixo.',
  signingIn: 'Entrando…', open: 'Abrir a página de login', copy: 'Copiar link de login', copied: 'Link copiado',
  cancel: 'Cancelar', failed: 'O login com o Feishu não foi concluído. Tente novamente.', unavailable: 'O login com o Feishu não está disponível nesta versão. Entre em contato com o administrador.',
  expired: 'O tempo para entrar esgotou. Tente novamente.', retry: 'Tentar novamente',
  signOutTitle: 'Sair do Feishu?', signOutDescription: 'Seus modelos, sessões e configurações permanecem neste dispositivo.',
} as const satisfies Record<keyof typeof en, string>
/** Keys shared by the Feishu account locale dictionaries. */
export type FeishuAccountKey = keyof typeof en

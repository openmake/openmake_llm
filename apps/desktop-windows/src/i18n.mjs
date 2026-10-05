// 화면 문구 — 웹·macOS Companion 과 같은 5개 언어. 키가 언어마다 같아야 한다(test/i18n.test.mjs 가 확인).
export const MESSAGES = {
  ko: {
    'menu.checkUpdates': '업데이트 확인', 'update.title': '업데이트', 'update.available': '새 버전 {0} 이 있습니다. 지금 내려받아 설치할까요?', 'update.install': '내려받아 설치', 'update.later': '나중에', 'update.none': '최신 버전입니다.', 'update.failed': '업데이트를 받지 못했습니다: {0}', 'update.badHash': '내려받은 파일이 게시된 것과 다릅니다(무결성 확인 실패). 설치하지 않았습니다.',
    'tray.tooltip': 'OpenMake Companion', 'menu.status': '상태: {0}', 'menu.connectFolder': '작업 폴더 연결…', 'menu.addFolder': '작업 폴더 추가…',
    'menu.disconnect': '연결 해제', 'menu.disconnectAll': '모두 연결 해제', 'menu.openWeb': '웹에서 열기', 'menu.settings': '설정…', 'menu.quit': '종료',
    'menu.browser.takeover': '브라우저 넘겨받기 (에이전트 일시 정지)', 'menu.browser.release': '브라우저 돌려주기 (에이전트 재개)', 'menu.browser.stop': '브라우저 작업 중지',
    'status.idle': '연결된 폴더 없음', 'status.needKey': 'API key 필요 — 설정에서 입력', 'status.connected': '연결됨', 'status.connecting': '연결 중…', 'status.reconnecting': '끊김 — 재연결 대기', 'status.serverError': '서버 오류: {0}',
    'confirm.title': '명령 실행 확인', 'confirm.message': '에이전트가 이 PC 에서 명령을 실행하려 합니다.', 'confirm.detail': '폴더: {0}\n\n{1}', 'confirm.allow': '허용', 'confirm.allowAll': '이 작업 동안 모두 허용', 'confirm.deny': '거부',
    'notice.approval.title': '승인 대기', 'notice.approval.body': '작업이 승인을 기다립니다: {0}',
    'settings.title': 'OpenMake Companion 설정', 'settings.server': '서버 주소', 'settings.serverHelp': '브라우저에서 OpenMake 를 여는 주소를 그대로 넣으세요(예: https://chat.회사.co.kr, http://서버:3010). 비워 두면 기본 주소를 씁니다.', 'settings.serverInsecure': '암호화되지 않은 연결(http)입니다. API key 와 작업 내용이 그대로 전송되므로 사내망처럼 믿을 수 있는 네트워크에서만 쓰세요.', 'settings.serverInvalid': '서버 주소가 올바르지 않습니다. http:// 또는 https:// 로 시작하는 주소를 넣으세요.', 'settings.apiKey': 'API key (bridge 스코프)', 'settings.browser': '에이전트의 브라우저 사용 허용 (전용 Chrome 프로필)', 'settings.save': '저장', 'settings.saved': '저장됨', 'settings.noEncryption': '이 PC 에서 자격증명 암호화를 쓸 수 없어 API key 를 저장하지 않았습니다',
  },
  en: {
    'menu.checkUpdates': 'Check for Updates', 'update.title': 'Update', 'update.available': 'Version {0} is available. Download and install it now?', 'update.install': 'Download and Install', 'update.later': 'Later', 'update.none': 'You are up to date.', 'update.failed': 'Could not get the update: {0}', 'update.badHash': 'The downloaded file does not match the published one (integrity check failed). It was not installed.',
    'tray.tooltip': 'OpenMake Companion', 'menu.status': 'Status: {0}', 'menu.connectFolder': 'Connect Work Folder…', 'menu.addFolder': 'Add Work Folder…',
    'menu.disconnect': 'Disconnect', 'menu.disconnectAll': 'Disconnect All', 'menu.openWeb': 'Open on the Web', 'menu.settings': 'Settings…', 'menu.quit': 'Quit',
    'menu.browser.takeover': 'Take Over Browser (Pause Agent)', 'menu.browser.release': 'Hand Back Browser (Resume Agent)', 'menu.browser.stop': 'Stop Browser Task',
    'status.idle': 'No folder connected', 'status.needKey': 'API key required — enter it in Settings', 'status.connected': 'Connected', 'status.connecting': 'Connecting…', 'status.reconnecting': 'Disconnected — waiting to reconnect', 'status.serverError': 'Server error: {0}',
    'confirm.title': 'Confirm Command', 'confirm.message': 'The agent wants to run a command on this PC.', 'confirm.detail': 'Folder: {0}\n\n{1}', 'confirm.allow': 'Allow', 'confirm.allowAll': 'Allow All for This Task', 'confirm.deny': 'Deny',
    'notice.approval.title': 'Approval Needed', 'notice.approval.body': 'A task is waiting for approval: {0}',
    'settings.title': 'OpenMake Companion Settings', 'settings.server': 'Server URL', 'settings.serverHelp': 'Enter the address you use to open OpenMake in your browser (for example https://chat.company.com or http://server:3010). Leave empty to use the default.', 'settings.serverInsecure': 'This connection is not encrypted (http). Your API key and task content are sent as-is, so use it only on a network you trust, such as your company network.', 'settings.serverInvalid': 'The server address is not valid. Enter an address that starts with http:// or https://.', 'settings.apiKey': 'API key (bridge scope)', 'settings.browser': 'Allow the agent to use a browser (dedicated Chrome profile)', 'settings.save': 'Save', 'settings.saved': 'Saved', 'settings.noEncryption': 'Credential encryption is unavailable on this PC, so the API key was not saved',
  },
  ja: {
    'menu.checkUpdates': 'アップデートを確認', 'update.title': 'アップデート', 'update.available': '新しいバージョン {0} があります。今すぐダウンロードしてインストールしますか？', 'update.install': 'ダウンロードしてインストール', 'update.later': '後で', 'update.none': '最新バージョンです。', 'update.failed': 'アップデートを取得できませんでした: {0}', 'update.badHash': 'ダウンロードしたファイルが公開されたものと一致しません（整合性確認に失敗）。インストールしませんでした。',
    'tray.tooltip': 'OpenMake Companion', 'menu.status': '状態: {0}', 'menu.connectFolder': '作業フォルダを接続…', 'menu.addFolder': '作業フォルダを追加…',
    'menu.disconnect': '接続解除', 'menu.disconnectAll': 'すべて接続解除', 'menu.openWeb': 'Web で開く', 'menu.settings': '設定…', 'menu.quit': '終了',
    'menu.browser.takeover': 'ブラウザを引き継ぐ（エージェントを一時停止）', 'menu.browser.release': 'ブラウザを戻す（エージェントを再開）', 'menu.browser.stop': 'ブラウザ作業を停止',
    'status.idle': '接続中のフォルダなし', 'status.needKey': 'API key が必要です — 設定で入力してください', 'status.connected': '接続済み', 'status.connecting': '接続中…', 'status.reconnecting': '切断 — 再接続待ち', 'status.serverError': 'サーバーエラー: {0}',
    'confirm.title': 'コマンド実行の確認', 'confirm.message': 'エージェントがこの PC でコマンドを実行しようとしています。', 'confirm.detail': 'フォルダ: {0}\n\n{1}', 'confirm.allow': '許可', 'confirm.allowAll': 'このタスク中はすべて許可', 'confirm.deny': '拒否',
    'notice.approval.title': '承認待ち', 'notice.approval.body': 'タスクが承認を待っています: {0}',
    'settings.title': 'OpenMake Companion 設定', 'settings.server': 'サーバーアドレス', 'settings.serverHelp': 'ブラウザで OpenMake を開くアドレスをそのまま入力してください（例: https://chat.company.co.jp、http://server:3010）。空欄の場合は既定のアドレスを使います。', 'settings.serverInsecure': '暗号化されていない接続（http）です。API キーと作業内容がそのまま送信されるため、社内ネットワークなど信頼できるネットワークでのみ使用してください。', 'settings.serverInvalid': 'サーバーアドレスが正しくありません。http:// または https:// で始まるアドレスを入力してください。', 'settings.apiKey': 'API key（bridge スコープ）', 'settings.browser': 'エージェントのブラウザ使用を許可（専用 Chrome プロファイル）', 'settings.save': '保存', 'settings.saved': '保存しました', 'settings.noEncryption': 'この PC では資格情報の暗号化を使えないため、API key を保存しませんでした',
  },
  zh: {
    'menu.checkUpdates': '检查更新', 'update.title': '更新', 'update.available': '有新版本 {0}。现在下载并安装吗？', 'update.install': '下载并安装', 'update.later': '稍后', 'update.none': '已是最新版本。', 'update.failed': '无法获取更新：{0}', 'update.badHash': '下载的文件与发布的不一致（完整性校验失败），未安装。',
    'tray.tooltip': 'OpenMake Companion', 'menu.status': '状态：{0}', 'menu.connectFolder': '连接工作文件夹…', 'menu.addFolder': '添加工作文件夹…',
    'menu.disconnect': '断开连接', 'menu.disconnectAll': '全部断开', 'menu.openWeb': '在网页中打开', 'menu.settings': '设置…', 'menu.quit': '退出',
    'menu.browser.takeover': '接管浏览器（暂停代理）', 'menu.browser.release': '交还浏览器（恢复代理）', 'menu.browser.stop': '停止浏览器任务',
    'status.idle': '未连接文件夹', 'status.needKey': '需要 API key — 请在设置中输入', 'status.connected': '已连接', 'status.connecting': '连接中…', 'status.reconnecting': '已断开 — 等待重连', 'status.serverError': '服务器错误：{0}',
    'confirm.title': '确认执行命令', 'confirm.message': '代理想在这台电脑上执行命令。', 'confirm.detail': '文件夹：{0}\n\n{1}', 'confirm.allow': '允许', 'confirm.allowAll': '本任务期间全部允许', 'confirm.deny': '拒绝',
    'notice.approval.title': '等待批准', 'notice.approval.body': '任务正在等待批准：{0}',
    'settings.title': 'OpenMake Companion 设置', 'settings.server': '服务器地址', 'settings.serverHelp': '请输入在浏览器中打开 OpenMake 时使用的地址（例如 https://chat.company.com、http://server:3010）。留空则使用默认地址。', 'settings.serverInsecure': '这是未加密的连接（http）。API key 和任务内容将以明文发送，请仅在公司内网等可信网络中使用。', 'settings.serverInvalid': '服务器地址不正确。请输入以 http:// 或 https:// 开头的地址。', 'settings.apiKey': 'API key（bridge 范围）', 'settings.browser': '允许代理使用浏览器（专用 Chrome 配置文件）', 'settings.save': '保存', 'settings.saved': '已保存', 'settings.noEncryption': '这台电脑无法使用凭据加密，因此没有保存 API key',
  },
  de: {
    'menu.checkUpdates': 'Nach Updates suchen', 'update.title': 'Update', 'update.available': 'Version {0} ist verfügbar. Jetzt herunterladen und installieren?', 'update.install': 'Herunterladen und installieren', 'update.later': 'Später', 'update.none': 'Sie sind auf dem neuesten Stand.', 'update.failed': 'Update konnte nicht abgerufen werden: {0}', 'update.badHash': 'Die heruntergeladene Datei stimmt nicht mit der veröffentlichten überein (Integritätsprüfung fehlgeschlagen). Sie wurde nicht installiert.',
    'tray.tooltip': 'OpenMake Companion', 'menu.status': 'Status: {0}', 'menu.connectFolder': 'Arbeitsordner verbinden…', 'menu.addFolder': 'Arbeitsordner hinzufügen…',
    'menu.disconnect': 'Trennen', 'menu.disconnectAll': 'Alle trennen', 'menu.openWeb': 'Im Web öffnen', 'menu.settings': 'Einstellungen…', 'menu.quit': 'Beenden',
    'menu.browser.takeover': 'Browser übernehmen (Agent pausieren)', 'menu.browser.release': 'Browser zurückgeben (Agent fortsetzen)', 'menu.browser.stop': 'Browser-Aufgabe stoppen',
    'status.idle': 'Kein Ordner verbunden', 'status.needKey': 'API key erforderlich — in den Einstellungen eingeben', 'status.connected': 'Verbunden', 'status.connecting': 'Verbinden…', 'status.reconnecting': 'Getrennt — warte auf Wiederverbindung', 'status.serverError': 'Serverfehler: {0}',
    'confirm.title': 'Befehl bestätigen', 'confirm.message': 'Der Agent möchte auf diesem PC einen Befehl ausführen.', 'confirm.detail': 'Ordner: {0}\n\n{1}', 'confirm.allow': 'Erlauben', 'confirm.allowAll': 'Für diese Aufgabe alle erlauben', 'confirm.deny': 'Ablehnen',
    'notice.approval.title': 'Genehmigung erforderlich', 'notice.approval.body': 'Eine Aufgabe wartet auf Genehmigung: {0}',
    'settings.title': 'OpenMake Companion – Einstellungen', 'settings.server': 'Serveradresse', 'settings.serverHelp': 'Geben Sie die Adresse ein, mit der Sie OpenMake im Browser öffnen (z. B. https://chat.firma.de oder http://server:3010). Leer lassen, um die Standardadresse zu verwenden.', 'settings.serverInsecure': 'Diese Verbindung ist nicht verschlüsselt (http). API-Key und Aufgabeninhalte werden unverschlüsselt übertragen – nur in einem vertrauenswürdigen Netzwerk wie dem Firmennetz verwenden.', 'settings.serverInvalid': 'Die Serveradresse ist ungültig. Geben Sie eine Adresse ein, die mit http:// oder https:// beginnt.', 'settings.apiKey': 'API key (bridge-Bereich)', 'settings.browser': 'Dem Agenten die Browsernutzung erlauben (eigenes Chrome-Profil)', 'settings.save': 'Speichern', 'settings.saved': 'Gespeichert', 'settings.noEncryption': 'Auf diesem PC ist keine Verschlüsselung für Zugangsdaten verfügbar – der API key wurde nicht gespeichert',
  },
};
export const DEFAULT_LOCALE = 'ko';

/** OS 언어(예: 'ko-KR', 'zh-CN') → 지원 언어. 모르면 기본 언어. */
export function pickLocale(osLocale) {
  const base = String(osLocale || '').toLowerCase().split(/[-_]/)[0];
  return Object.prototype.hasOwnProperty.call(MESSAGES, base) ? base : DEFAULT_LOCALE;
}

/** 문구 조회 — {0}·{1} 자리에 인자를 넣는다. 없는 키는 키 그대로(누락이 화면에서 드러나게). */
export function translate(locale, key, ...args) {
  const text = (MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE])[key] ?? key;
  return text.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ''));
}

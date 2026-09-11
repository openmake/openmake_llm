// 다국어 문자열 — apps/desktop-native/Localization/<lang>.lproj/Localizable.strings
// (ko·en·ja·zh-Hans, 웹 LOCALES 와 같은 4개 언어). build.sh 가 앱 Resources 로 복사한다.
// 키는 식별자이고 ko 가 개발 언어(웹 DEFAULT_LOCALE 과 동일)다. 네 표의 키 집합과 소스가 쓰는
// L("키") 는 check-l10n.sh 가 빌드 전에 대조한다 — 빠진 키는 그 언어 사용자에게 식별자로 보이기 때문.
import Foundation

func L(_ key: String, _ args: CVarArg...) -> String {
    let format = NSLocalizedString(key, comment: "")
    return args.isEmpty ? format : String(format: format, arguments: args)
}

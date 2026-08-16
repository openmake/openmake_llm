// 앱 설정 — 서버 URL 은 계약 규약대로 클라이언트가 주입 (contract 의 servers 미포함)
import Foundation

enum AppConfig {
    /// 기본 운영 서버. 개발 시 Xcode scheme 환경변수 OPENMAKE_SERVER_URL 로 오버라이드.
    static var serverURL: URL {
        if let raw = ProcessInfo.processInfo.environment["OPENMAKE_SERVER_URL"],
           let url = URL(string: raw) {
            return url
        }
        return URL(string: "https://chat.openmake.cc")!
    }

    /// OAuth 콜백 URL scheme — 서버 MOBILE_AUTH.APP_SCHEME + Info.plist CFBundleURLSchemes 와 일치 (축 2)
    static let appScheme = "openmake"
}

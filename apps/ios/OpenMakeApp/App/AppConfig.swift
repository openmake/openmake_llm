// 앱 설정 — 서버 URL 은 계약 규약대로 클라이언트가 주입 (contract 의 servers 미포함)
import Foundation

enum AppConfig {
    /// 서버 주소 — 실행 환경변수 OPENMAKE_SERVER_URL > 빌드 설정(Info.plist OpenMakeServerURL) > localhost.
    /// 설치마다 주소가 다르므로 코드에 운영 주소를 두지 않는다 — 배포 빌드는 Info.plist 키로 넣는다.
    static var serverURL: URL {
        if let raw = ProcessInfo.processInfo.environment["OPENMAKE_SERVER_URL"],
           let url = URL(string: raw) {
            return url
        }
        if let raw = Bundle.main.object(forInfoDictionaryKey: "OpenMakeServerURL") as? String,
           !raw.isEmpty, let url = URL(string: raw) {
            return url
        }
        return URL(string: "http://localhost:52416")!
    }

    /// OAuth 콜백 URL scheme — 서버 MOBILE_AUTH.APP_SCHEME + Info.plist CFBundleURLSchemes 와 일치 (축 2)
    static let appScheme = "openmake"
}

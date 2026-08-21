// 앱 전역 상태 — 인증 상태와 OpenMakeKit 클라이언트 (서버 상태와 UI 상태 분리 원칙)
import Foundation
import Observation
import OpenMakeKit

@MainActor
@Observable
final class AppModel {
    enum AuthState {
        case checking
        case loggedOut
        case loggedIn(OpenMakeClient.PublicUser)
    }

    private(set) var authState: AuthState = .checking
    let client: OpenMakeClient
    private let tokenStore: TokenStore

    // 모델/에이전트 선택 (축 3 Step 5) — nil = 서버 기본/에이전트 미지정
    private(set) var modelCatalog: ModelCatalog?
    private(set) var agents: [OpenMakeClient.UserAgent] = []
    var selectedModelId: String?
    var selectedAgentId: String?

    /// 채팅 모드 토글 — 서버 계약(WsChatRequest) 필드 그대로 (웹의 Mode 토글·Style 대응)
    var modes = ChatModes()

    struct ChatModes {
        var webSearch = false
        var thinking = false
        var imageGen = false
        var artifact = false
        var discussion = false
        var deepResearch = false
        var agentTask = false
        /// 위치 첨부 (폰 기능 2단계, 옵트인) — 켠 턴에만 GPS 1회 획득해 요청에 첨부
        var attachLocation = false
        var style: Style = .styleDefault

        var activeLabels: [String] {
            var labels: [String] = []
            if webSearch { labels.append("웹 검색") }
            if attachLocation { labels.append("위치") }
            if thinking { labels.append("추론") }
            if imageGen { labels.append("이미지") }
            if artifact { labels.append("아티팩트") }
            if discussion { labels.append("토론") }
            if deepResearch { labels.append("딥리서치") }
            if agentTask { labels.append("에이전트 작업") }
            return labels
        }
    }

    init(client: OpenMakeClient? = nil) {
        var store: TokenStore = KeychainTokenStore()
        #if DEBUG
        // 시뮬레이터 스모크: 무서명/ad-hoc 빌드는 Keychain entitlement 부재(-34018)로
        // SecItem 접근이 실패하므로 토큰 주입 모드에선 인메모리 저장을 쓴다. Release 미포함.
        if ProcessInfo.processInfo.environment["OPENMAKE_TEST_ACCESS"]?.isEmpty == false {
            store = InMemoryTokenStore()
        }
        #endif
        self.tokenStore = store
        self.client = client ?? OpenMakeClient(
            configuration: .init(serverURL: AppConfig.serverURL),
            tokenStore: store)
        NotificationManager.shared.bind(client: self.client)
    }

    /// 앱 시작 시 저장된 세션 확인 (Keychain 토큰 → me)
    func bootstrap() async {
        #if DEBUG
        // 시뮬레이터 스모크용 세션 주입 (mint 토큰 — 비밀번호 미보유 환경). Release 미포함.
        if let access = ProcessInfo.processInfo.environment["OPENMAKE_TEST_ACCESS"],
           let refresh = ProcessInfo.processInfo.environment["OPENMAKE_TEST_REFRESH"],
           !access.isEmpty {
            tokenStore.save(AuthTokens(access: access, refresh: refresh))
        }
        // 모드 토글 스모크 — OPENMAKE_UITEST_MODES=image,websearch 형식
        if let raw = ProcessInfo.processInfo.environment["OPENMAKE_UITEST_MODES"] {
            for mode in raw.split(separator: ",").map({ $0.trimmingCharacters(in: .whitespaces) }) {
                switch mode {
                case "image": modes.imageGen = true
                case "websearch": modes.webSearch = true
                case "thinking": modes.thinking = true
                case "deepresearch": modes.deepResearch = true
                default: break
                }
            }
        }
        #endif
        guard await client.isAuthenticated else {
            authState = .loggedOut
            return
        }
        do {
            if let user = try await client.me() {
                authState = .loggedIn(user)
                return
            }
        } catch {
            // notAuthenticated(refresh 실패 포함)·네트워크 오류 — 로그인 화면으로
        }
        authState = .loggedOut
    }

    func login(email: String, password: String) async throws {
        let user = try await client.login(email: email, password: password)
        authState = .loggedIn(user)
        await NotificationManager.shared.activate()
    }

    /// OAuth exchange code → 로그인 (축 2 계약 — `openmake://auth/callback?code=` 수신 후)
    func exchangeLogin(code: String) async throws {
        let user = try await client.exchange(code: code)
        authState = .loggedIn(user)
        await NotificationManager.shared.activate()
    }

    func logout() async {
        await client.logout()
        authState = .loggedOut
        modelCatalog = nil
        agents = []
        selectedModelId = nil
        selectedAgentId = nil
    }

    /// 모델/에이전트 카탈로그 로드 — 실패해도 채팅은 서버 기본으로 동작 (fail-open)
    func loadCatalog() async {
        async let catalogTask = client.modelCatalog()
        async let agentsTask = client.userAgents()
        modelCatalog = try? await catalogTask
        agents = (try? await agentsTask) ?? []
    }
}

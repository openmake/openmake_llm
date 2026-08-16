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

    // 모델/에이전트 선택 (축 3 Step 5) — nil = 서버 기본/에이전트 미지정
    private(set) var modelCatalog: ModelCatalog?
    private(set) var agents: [OpenMakeClient.UserAgent] = []
    var selectedModelId: String?
    var selectedAgentId: String?

    init(client: OpenMakeClient? = nil) {
        self.client = client ?? OpenMakeClient(
            configuration: .init(serverURL: AppConfig.serverURL),
            tokenStore: KeychainTokenStore())
    }

    /// 앱 시작 시 저장된 세션 확인 (Keychain 토큰 → me)
    func bootstrap() async {
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
    }

    /// OAuth exchange code → 로그인 (축 2 계약 — `openmake://auth/callback?code=` 수신 후)
    func exchangeLogin(code: String) async throws {
        let user = try await client.exchange(code: code)
        authState = .loggedIn(user)
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

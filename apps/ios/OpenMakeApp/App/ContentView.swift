// 루트 라우팅 — 인증 상태에 따라 로그인/대화 목록 분기
import SwiftUI
import OpenMakeKit

struct ContentView: View {
    @State private var model = AppModel()

    var body: some View {
        #if DEBUG
        if ProcessInfo.processInfo.environment["OPENMAKE_DESIGN_SHOWCASE"] == "1" {
            DesignSystemShowcase()
        } else {
            authenticatedContent
        }
        #else
        authenticatedContent
        #endif
    }

    @ViewBuilder
    private var authenticatedContent: some View {
        Group {
            switch model.authState {
            case .checking:
                ProgressView("세션 확인 중…")
            case .loggedOut:
                LoginView()
            case .loggedIn:
                ConversationListView()
            }
        }
        .environment(model)
        .task {
            await model.bootstrap()
            await NotificationManager.shared.activate()
        }
    }
}

#Preview {
    ContentView()
}

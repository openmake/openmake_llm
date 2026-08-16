// 대화 목록 (축 3 Step 3) — pull-to-refresh · 스와이프 삭제 · 이력 내비게이션
import SwiftUI
import OpenMakeKit

struct ConversationListView: View {
    @Environment(AppModel.self) private var model
    @State private var sessions: [OpenMakeClient.SessionSummary] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showNewChat = false
    @State private var autoChatFired = false

    var body: some View {
        NavigationStack {
            Group {
                if let errorMessage {
                    ContentUnavailableView(
                        "불러오기 실패", systemImage: "wifi.exclamationmark",
                        description: Text(errorMessage))
                } else if sessions.isEmpty && !isLoading {
                    ContentUnavailableView(
                        "대화가 없습니다", systemImage: "bubble.left.and.bubble.right",
                        description: Text("웹에서 시작한 대화도 여기 표시됩니다"))
                } else {
                    List {
                        ForEach(sessions, id: \.id) { session in
                            NavigationLink(value: session) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(session.title)
                                        .font(.body)
                                        .lineLimit(1)
                                    Text("\(session.model) · 메시지 \(session.messageCount)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .onDelete { offsets in
                            Task { await delete(at: offsets) }
                        }
                    }
                }
            }
            .navigationTitle("대화")
            .navigationDestination(for: OpenMakeClient.SessionSummary.self) { session in
                ConversationDetailView(session: session)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("새 대화", systemImage: "square.and.pencil") {
                        showNewChat = true
                    }
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button("로그아웃", systemImage: "rectangle.portrait.and.arrow.right") {
                        Task { await model.logout() }
                    }
                }
            }
            .navigationDestination(isPresented: $showNewChat) {
                ConversationDetailView(session: nil)
            }
            .refreshable { await load() }
            .task {
                await load()
                await model.loadCatalog()
                #if DEBUG
                // 시뮬레이터 스모크: 자동으로 새 대화 진입 (Release 미포함)
                if ProcessInfo.processInfo.environment["OPENMAKE_UITEST_MESSAGE"]?.isEmpty == false,
                   !autoChatFired {
                    autoChatFired = true
                    showNewChat = true
                }
                #endif
            }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        errorMessage = nil
        do {
            sessions = try await model.client.sessions()
        } catch let error as OpenMakeAPIError {
            if error == .notAuthenticated {
                await model.logout()
                return
            }
            errorMessage = "목록을 불러오지 못했습니다"
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func delete(at offsets: IndexSet) async {
        let targets = offsets.map { sessions[$0] }
        for target in targets {
            do {
                try await model.client.deleteSession(id: target.id)
                sessions.removeAll { $0.id == target.id }
            } catch {
                errorMessage = "삭제에 실패했습니다"
            }
        }
    }
}

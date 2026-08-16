// 대화 목록 — LUMEN 시안 ② : 워드마크 네비 · 도트 메타 · accent FAB
import SwiftUI
import OpenMakeKit

struct ConversationListView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var sessions: [OpenMakeClient.SessionSummary] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showNewChat = false
    @State private var showSettings = false
    @State private var showDrawer = false
    @State private var showAgentTasks = false
    @State private var selectedSession: OpenMakeClient.SessionSummary?
    @State private var searchText = ""
    @State private var autoChatFired = false

    private var filtered: [OpenMakeClient.SessionSummary] {
        let query = searchText.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return sessions }
        return sessions.filter { $0.title.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottomTrailing) {
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
                            ForEach(filtered, id: \.id) { session in
                                NavigationLink(value: session) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(session.title)
                                            .font(.system(size: 15, weight: .semibold))
                                            .foregroundStyle(Lumen.fg)
                                            .lineLimit(1)
                                        HStack(spacing: 6) {
                                            LumenDot(size: 6)
                                            Text("\(shortModel(session.model)) · 메시지 \(session.messageCount)")
                                                .font(.caption)
                                                .foregroundStyle(Lumen.muted)
                                                .lineLimit(1)
                                        }
                                    }
                                    .padding(.vertical, 4)
                                }
                                .listRowBackground(Lumen.bg)
                                .listRowSeparatorTint(Lumen.border)
                            }
                            .onDelete { offsets in
                                Task { await delete(at: offsets) }
                            }
                        }
                        .listStyle(.plain)
                        .scrollContentBackground(.hidden)
                    }
                }

                Button {
                    showNewChat = true
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 21, weight: .medium))
                        .foregroundStyle(Lumen.accentFg)
                        .frame(width: 52, height: 52)
                        .background(Lumen.accent, in: Circle())
                        .shadow(color: Lumen.accent.opacity(0.35), radius: 10, y: 4)
                }
                .padding(.trailing, 18)
                .padding(.bottom, 10)
                .accessibilityLabel("새 대화")
            }
            .background(Lumen.bg)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Wordmark(size: 18)
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button("메뉴", systemImage: "line.3.horizontal") {
                        setDrawerPresented(true)
                    }
                    .tint(Lumen.fg2)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: "대화 검색")
            .navigationDestination(for: OpenMakeClient.SessionSummary.self) { session in
                ConversationDetailView(session: session)
            }
            .navigationDestination(isPresented: $showNewChat) {
                ConversationDetailView(session: nil)
            }
            .navigationDestination(isPresented: $showAgentTasks) {
                AgentTaskListView()
            }
            .navigationDestination(isPresented: Binding(
                get: { selectedSession != nil },
                set: { if !$0 { selectedSession = nil } }
            )) {
                if let selectedSession {
                    ConversationDetailView(session: selectedSession)
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsSheet()
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
            .onReceive(NotificationCenter.default.publisher(for: .openMakeNotificationURL)) { notification in
                guard let url = notification.object as? String else { return }
                handleNotificationURL(url)
            }
        }
        .tint(Lumen.accent)
        .overlay {
            if showDrawer {
                LumenDrawer(
                    sessions: sessions,
                    email: accountEmail,
                    onDismiss: { setDrawerPresented(false) },
                    onNewChat: {
                        showDrawer = false
                        showNewChat = true
                    },
                    onAgentTasks: {
                        showDrawer = false
                        showAgentTasks = true
                    },
                    onDeepResearch: {
                        model.modes.deepResearch = true
                        model.modes.agentTask = false
                        showDrawer = false
                        showNewChat = true
                    },
                    onConversation: { session in
                        showDrawer = false
                        selectedSession = session
                    },
                    onSettings: {
                        showDrawer = false
                        showSettings = true
                    })
            }
        }
    }

    private var accountEmail: String? {
        if case .loggedIn(let user) = model.authState { return user.email }
        return nil
    }

    private func setDrawerPresented(_ presented: Bool) {
        if reduceMotion {
            showDrawer = presented
        } else {
            withAnimation(.easeOut(duration: 0.2)) {
                showDrawer = presented
            }
        }
    }

    private func handleNotificationURL(_ url: String) {
        showDrawer = false
        if url.hasPrefix("/agent-tasks") {
            selectedSession = nil
            showNewChat = false
            showAgentTasks = true
            return
        }
        let chatPrefix = "/chat/"
        guard url.hasPrefix(chatPrefix) else { return }
        let sessionId = String(url.dropFirst(chatPrefix.count))
        guard !sessionId.isEmpty else { return }
        showAgentTasks = false
        showNewChat = false
        if let session = sessions.first(where: { $0.id == sessionId }) {
            selectedSession = session
            return
        }
        Task {
            await load()
            selectedSession = sessions.first { $0.id == sessionId }
        }
    }

    /// "local-llm:qwen3.6-35b-a3b" → "qwen3.6-35b-a3b" (provider prefix 제거)
    private func shortModel(_ model: String) -> String {
        model.split(separator: ":").last.map(String.init) ?? model
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
        let targets = offsets.map { filtered[$0] }
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

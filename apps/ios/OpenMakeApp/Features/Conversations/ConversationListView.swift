// 대화 목록 — LUMEN 시안 ② : 워드마크 네비 · 도트 메타 · accent FAB
import SwiftUI
import OpenMakeKit

struct ConversationListView: View {
    @Environment(AppModel.self) private var model
    @State private var sessions: [OpenMakeClient.SessionSummary] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showNewChat = false
    @State private var showSettings = false
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
                    Button("설정", systemImage: "gearshape") {
                        showSettings = true
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
        }
        .tint(Lumen.accent)
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

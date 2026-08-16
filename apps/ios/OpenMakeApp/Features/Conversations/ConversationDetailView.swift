// 대화 화면 — LUMEN 시안 ③④ : 도트 헤더 · user 버블(테일) · 캡슐 컴포저 · 모드 칩
import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import OpenMakeKit

struct ConversationDetailView: View {
    /// nil = 새 대화 (첫 전송 시 session_created 로 sessionId 채택)
    let session: OpenMakeClient.SessionSummary?

    @Environment(AppModel.self) private var model
    @State private var chat: ChatSessionModel?
    @State private var draft = ""

    var body: some View {
        Group {
            if let chat {
                ChatTranscriptView(chat: chat, draft: $draft)
            } else {
                ProgressView()
            }
        }
        .background(Lumen.bg)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    Text(session?.title ?? "새 대화")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Lumen.fg)
                        .lineLimit(1)
                    Text(activeModelName)
                        .font(.system(size: 10.5))
                        .foregroundStyle(Lumen.muted)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                ModelAgentMenu()
                    .tint(Lumen.fg2)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if chat == nil {
                let chatModel = ChatSessionModel(
                    client: model.client,
                    serverURL: AppConfig.serverURL,
                    sessionId: session?.id)
                chat = chatModel
                await chatModel.loadHistory()
                #if DEBUG
                // 시뮬레이터 스모크: 새 대화에 자동 전송 (Release 미포함)
                if session == nil,
                   let message = ProcessInfo.processInfo.environment["OPENMAKE_UITEST_MESSAGE"],
                   !message.isEmpty, chatModel.messages.isEmpty {
                    await chatModel.send(message, model: model.selectedModelId, modes: model.modes)
                }
                #endif
            }
        }
        .onDisappear {
            chat?.teardown()
        }
    }

    private var activeModelName: String {
        let full = model.selectedModelId ?? model.modelCatalog?.defaultModel ?? ""
        let short = full.split(separator: ":").last.map(String.init) ?? full
        if model.selectedAgentId != nil,
           let agent = model.agents.first(where: { $0.id == model.selectedAgentId }) {
            return "\(short) · \(agent.name)"
        }
        return short.isEmpty ? "OpenMake" : short
    }
}

/// 모델/에이전트 선택 메뉴 — nil 선택 = 서버 기본/에이전트 미지정
struct ModelAgentMenu: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Menu {
            if let catalog = model.modelCatalog {
                Section("모델") {
                    ForEach(catalog.models.filter { $0.available != false }, id: \.modelId) { entry in
                        Button {
                            model.selectedModelId = entry.modelId
                        } label: {
                            if isSelected(entry.modelId, catalog: catalog) {
                                Label(entry.name, systemImage: "checkmark")
                            } else {
                                Text(entry.name)
                            }
                        }
                    }
                }
            }
            if !model.agents.isEmpty {
                Section("에이전트") {
                    Button {
                        model.selectedAgentId = nil
                    } label: {
                        if model.selectedAgentId == nil {
                            Label("없음", systemImage: "checkmark")
                        } else {
                            Text("없음")
                        }
                    }
                    ForEach(model.agents.filter(\.is_active), id: \.id) { agent in
                        Button {
                            model.selectedAgentId = agent.id
                        } label: {
                            if model.selectedAgentId == agent.id {
                                Label(agentTitle(agent), systemImage: "checkmark")
                            } else {
                                Text(agentTitle(agent))
                            }
                        }
                    }
                }
            }
        } label: {
            Image(systemName: "slider.horizontal.3")
        }
    }

    private func isSelected(_ modelId: String, catalog: ModelCatalog) -> Bool {
        (model.selectedModelId ?? catalog.defaultModel) == modelId
    }

    private func agentTitle(_ agent: OpenMakeClient.UserAgent) -> String {
        [agent.icon, agent.name].compactMap { $0 }.joined(separator: " ")
    }
}

private struct ChatTranscriptView: View {
    @Environment(AppModel.self) private var model
    @Bindable var chat: ChatSessionModel
    @Binding var draft: String

    @State private var photoItems: [PhotosPickerItem] = []
    @State private var pendingImages: [String] = []
    @State private var pendingFiles: [WsAttachedFile] = []
    @State private var showFileImporter = false
    @State private var attachError: String?

    var body: some View {
        VStack(spacing: 0) {
            transcript

            if let error = chat.errorMessage ?? attachError {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 4)
            }

            ChatComposer(
                draft: $draft,
                photoItems: $photoItems,
                pendingImages: $pendingImages,
                pendingFiles: $pendingFiles,
                showFileImporter: $showFileImporter,
                isStreaming: chat.isStreaming,
                onSubmit: submit)
        }
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: [.pdf, .plainText, .commaSeparatedText, .json, .data],
            allowsMultipleSelection: false
        ) { result in
            if case .success(let urls) = result, let url = urls.first {
                importFile(at: url)
            }
        }
        .onChange(of: photoItems) {
            Task { await loadPhotos() }
        }
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(Array(chat.messages.enumerated()), id: \.offset) { _, message in
                        MessageRow(message: message)
                    }

                    if let status = chat.statusText {
                        StatusLine(text: status, color: Lumen.success)
                    }
                    if chat.isThinking {
                        StatusLine(text: "생각 중…", color: Lumen.warn)
                    }
                    if !chat.streamingText.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            AssistantHead()
                            MarkdownText(content: chat.streamingText + " ▍")
                        }
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: chat.streamingText) {
                withAnimation(.easeOut(duration: 0.1)) { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onChange(of: chat.messages.count) {
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
    }

    private func submit() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        attachError = nil
        let images = pendingImages
        let files = pendingFiles
        pendingImages = []
        pendingFiles = []
        Task {
            await chat.send(
                text,
                model: model.selectedModelId,
                userAgentId: model.selectedAgentId,
                images: images,
                files: files,
                modes: model.modes)
        }
    }

    private func loadPhotos() async {
        for item in photoItems {
            if let data = try? await item.loadTransferable(type: Data.self) {
                pendingImages.append(DataURL.encode(data, mimeType: DataURL.imageMimeType(of: data)))
            }
        }
        photoItems = []
    }

    private func importFile(at url: URL) {
        let accessing = url.startAccessingSecurityScopedResource()
        defer { if accessing { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            attachError = "파일을 읽지 못했습니다"
            return
        }
        let type = UTType(filenameExtension: url.pathExtension)
        if type?.conforms(to: .text) == true, let text = String(data: data, encoding: .utf8) {
            pendingFiles.append(.text(
                name: url.lastPathComponent,
                mimeType: type?.preferredMIMEType ?? "text/plain",
                content: text))
            return
        }
        do {
            pendingFiles.append(try .binaryDocument(
                name: url.lastPathComponent,
                mimeType: type?.preferredMIMEType ?? "application/octet-stream",
                data: data))
        } catch {
            attachError = "파일이 너무 큽니다 (최대 20MB)"
        }
    }
}

/// assistant 응답 헤더 — 시그니처 도트 + 워드마크 캡션
private struct AssistantHead: View {
    var pulsing = true

    var body: some View {
        HStack(spacing: 6) {
            LumenDot(pulsing: pulsing)
            Text("OpenMake")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Lumen.muted)
        }
    }
}

/// LUMEN 메시지 행 — user 는 테일 버블(우측), assistant 는 도트 헤더 + 전체폭 마크다운
private struct MessageRow: View {
    let message: OpenMakeClient.ChatMessage

    var body: some View {
        if message.role == .user {
            HStack(alignment: .bottom) {
                Spacer(minLength: 48)
                VStack(alignment: .trailing, spacing: 4) {
                    if let images = message.images, !images.isEmpty {
                        Text("🖼️ 사진 \(images.count)장")
                            .font(.caption2)
                            .foregroundStyle(Lumen.muted)
                    }
                    Text(message.content)
                        .font(.system(size: 15))
                        .textSelection(.enabled)
                        .foregroundStyle(Lumen.fg)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(
                            Lumen.surface2,
                            in: UnevenRoundedRectangle(
                                topLeadingRadius: 18, bottomLeadingRadius: 18,
                                bottomTrailingRadius: 4, topTrailingRadius: 18))
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                AssistantHead(pulsing: false)
                MarkdownText(content: message.content)
            }
        }
    }
}

private struct StatusLine: View {
    let text: String
    var color: Color = Lumen.accent

    var body: some View {
        HStack(spacing: 7) {
            LumenDot(color: color, size: 6, pulsing: true)
            Text(text)
                .font(.system(size: 12))
                .foregroundStyle(Lumen.muted)
        }
        .transition(.opacity)
    }
}

/// LUMEN 컴포저 — accent-soft + 버튼, surface 입력 카드, 모드 칩(도트)
private struct ChatComposer: View {
    @Environment(AppModel.self) private var model
    @Binding var draft: String
    @Binding var photoItems: [PhotosPickerItem]
    @Binding var pendingImages: [String]
    @Binding var pendingFiles: [WsAttachedFile]
    @Binding var showFileImporter: Bool
    let isStreaming: Bool
    let onSubmit: () -> Void

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isStreaming
    }

    var body: some View {
        @Bindable var model = model
        VStack(spacing: 8) {
            attachmentChips
            modeChips

            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    Section("첨부") {
                        PhotosPicker(selection: $photoItems, maxSelectionCount: 3, matching: .images) {
                            Label("사진", systemImage: "photo")
                        }
                        Button { showFileImporter = true } label: {
                            Label("파일", systemImage: "doc")
                        }
                    }
                    Section("모드") {
                        Toggle("웹 검색", systemImage: "globe", isOn: $model.modes.webSearch)
                        Toggle("추론", systemImage: "brain", isOn: $model.modes.thinking)
                        Toggle("이미지 생성", systemImage: "photo.badge.plus", isOn: $model.modes.imageGen)
                        Toggle("아티팩트", systemImage: "doc.richtext", isOn: $model.modes.artifact)
                        Toggle("토론", systemImage: "person.2.wave.2", isOn: $model.modes.discussion)
                        Toggle("딥리서치", systemImage: "magnifyingglass.circle", isOn: $model.modes.deepResearch)
                    }
                    Picker("응답 스타일", systemImage: "text.alignleft", selection: $model.modes.style) {
                        Text("간결").tag(Style.concise)
                        Text("기본").tag(Style.styleDefault)
                        Text("상세").tag(Style.verbose)
                    }
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(Lumen.accent)
                        .frame(width: 36, height: 36)
                        .background(Lumen.accentSoft, in: Circle())
                }

                HStack(alignment: .bottom, spacing: 6) {
                    TextField("무엇이든 물어보세요", text: $draft, axis: .vertical)
                        .font(.system(size: 15))
                        .lineLimit(1...5)
                        .padding(.leading, 14)
                        .padding(.vertical, 9)

                    Button(action: onSubmit) {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(canSend ? Lumen.accentFg : Lumen.faint)
                            .frame(width: 30, height: 30)
                            .background(canSend ? Lumen.accent : Lumen.surface3, in: Circle())
                    }
                    .disabled(!canSend)
                    .padding(.trailing, 4)
                    .padding(.bottom, 3)
                }
                .background(Lumen.surface, in: RoundedRectangle(cornerRadius: 22))
                .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(Lumen.border))
                .shadow(color: .black.opacity(0.06), radius: 8, y: 2)
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 8)
        .background(Lumen.bg)
    }

    @ViewBuilder
    private var modeChips: some View {
        let labels = model.modes.activeLabels
        if !labels.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(labels, id: \.self) { label in
                        HStack(spacing: 5) {
                            LumenDot(size: 5)
                            Text(label)
                        }
                        .font(.system(size: 11, weight: .semibold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Lumen.accentSoft, in: Capsule())
                        .foregroundStyle(Lumen.accent)
                    }
                }
                .padding(.horizontal, 4)
            }
        }
    }

    @ViewBuilder
    private var attachmentChips: some View {
        if !pendingImages.isEmpty || !pendingFiles.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if !pendingImages.isEmpty {
                        chip(label: "🖼️ 사진 \(pendingImages.count)장") { pendingImages.removeAll() }
                    }
                    ForEach(pendingFiles, id: \.id) { file in
                        chip(label: "📄 \(file.name)") {
                            pendingFiles.removeAll { $0.id == file.id }
                        }
                    }
                }
                .padding(.horizontal, 4)
            }
        }
    }

    private func chip(label: String, onRemove: @escaping () -> Void) -> some View {
        HStack(spacing: 4) {
            Text(label).font(.caption)
            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill").font(.caption)
            }
        }
        .foregroundStyle(Lumen.fg2)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Lumen.surface2, in: Capsule())
    }
}

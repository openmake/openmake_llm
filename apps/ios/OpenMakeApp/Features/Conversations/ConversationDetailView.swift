// 대화 화면 (축 3 Step 3~5) — 이력 + WS 스트리밍 + 모델/에이전트 선택 + 첨부
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
        .navigationTitle(session?.title ?? "새 대화")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ModelAgentMenu()
            }
        }
        .task {
            if chat == nil {
                let chatModel = ChatSessionModel(
                    client: model.client,
                    serverURL: AppConfig.serverURL,
                    sessionId: session?.id)
                chat = chatModel
                await chatModel.loadHistory()
            }
        }
        .onDisappear {
            chat?.teardown()
        }
    }
}

/// 모델/에이전트 선택 메뉴 — nil 선택 = 서버 기본/에이전트 미지정
private struct ModelAgentMenu: View {
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
                    .padding(.horizontal, 12)
            }

            attachmentChips
            composer
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
                LazyVStack(spacing: 10) {
                    ForEach(Array(chat.messages.enumerated()), id: \.offset) { _, message in
                        MessageBubble(message: message)
                    }
                    if chat.isThinking {
                        HStack {
                            ProgressView()
                            Text("생각 중…")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Spacer()
                        }
                        .padding(.horizontal, 4)
                    }
                    if !chat.streamingText.isEmpty {
                        MessageBubble(message: .init(
                            role: .assistant, content: chat.streamingText,
                            model: nil, tokens: nil, images: nil, created_at: nil))
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .onChange(of: chat.streamingText) {
                proxy.scrollTo("bottom", anchor: .bottom)
            }
            .onChange(of: chat.messages.count) {
                proxy.scrollTo("bottom", anchor: .bottom)
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
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
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
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.fill.tertiary, in: Capsule())
    }

    private var composer: some View {
        HStack(spacing: 8) {
            Menu {
                PhotosPicker(selection: $photoItems, maxSelectionCount: 3, matching: .images) {
                    Label("사진", systemImage: "photo")
                }
                Button {
                    showFileImporter = true
                } label: {
                    Label("파일", systemImage: "doc")
                }
            } label: {
                Image(systemName: "plus.circle")
                    .font(.title2)
            }

            TextField("메시지 입력…", text: $draft, axis: .vertical)
                .lineLimit(1...4)
                .textFieldStyle(.roundedBorder)

            Button {
                submit()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title2)
            }
            .disabled(chat.isStreaming || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(12)
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
                files: files)
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

struct MessageBubble: View {
    let message: OpenMakeClient.ChatMessage

    private var isUser: Bool { message.role == .user }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 40) }
            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                if let images = message.images, !images.isEmpty {
                    Text("🖼️ 사진 \(images.count)장")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(message.content)
                    .font(.body)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(
                        isUser ? AnyShapeStyle(.tint) : AnyShapeStyle(.fill.secondary),
                        in: RoundedRectangle(cornerRadius: 14))
                    .foregroundStyle(isUser ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            }
            .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
            if !isUser { Spacer(minLength: 40) }
        }
    }
}

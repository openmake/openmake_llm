// 대화 폴더·태그 정리 (F19.5) — 웹 히스토리 폴더 레일·정리 대화상자 대응.
// 폴더·태그는 서버(conversation_folders·세션 tags)에 저장되므로 웹과 같은 분류를 본다.
import SwiftUI
import OpenMakeKit

/// 대화 목록 필터 — 전체·미분류·폴더·태그 중 하나 (서버 목록 쿼리 folderId/tag 로 전달)
enum SessionListFilter: Hashable {
    case all
    case unfiled
    case folder(String)
    case tag(String)

    var folderQuery: String? {
        switch self {
        case .unfiled: return OpenMakeClient.unfiledFolderFilter
        case .folder(let id): return id
        case .all, .tag: return nil
        }
    }

    var tagQuery: String? {
        if case .tag(let tag) = self { return tag }
        return nil
    }
}

struct SessionOrganizeSheet: View {
    let session: OpenMakeClient.SessionSummary
    let onSaved: () async -> Void

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var folders: [OpenMakeClient.ConversationFolder]
    @State private var folderId: String?
    @State private var tagsText: String
    @State private var newFolderName = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(
        session: OpenMakeClient.SessionSummary,
        folders: [OpenMakeClient.ConversationFolder],
        onSaved: @escaping () async -> Void
    ) {
        self.session = session
        self.onSaved = onSaved
        _folders = State(initialValue: folders)
        _folderId = State(initialValue: session.folderId)
        _tagsText = State(initialValue: (session.tags ?? []).joined(separator: ", "))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("폴더") {
                    Picker("폴더", selection: $folderId) {
                        Text("미분류").tag(String?.none)
                        ForEach(folders, id: \.id) { folder in
                            Text(folder.name).tag(Optional(folder.id))
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()

                    HStack {
                        TextField("새 폴더 이름", text: $newFolderName)
                        Button("추가") {
                            Task { await addFolder() }
                        }
                        .disabled(trimmedFolderName.isEmpty || isSaving)
                    }
                }

                Section {
                    TextField("쉼표로 구분 (예: 업무, 기획)", text: $tagsText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("태그")
                } footer: {
                    Text("태그는 소문자로 바뀌고 중복은 하나로 합쳐집니다")
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(session.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("취소") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("저장") {
                        Task { await save() }
                    }
                    .disabled(isSaving)
                }
            }
        }
    }

    private var trimmedFolderName: String {
        newFolderName.trimmingCharacters(in: .whitespaces)
    }

    /// 태그는 쉼표·줄바꿈으로만 나눈다 — 서버 태그는 공백을 포함할 수 있다
    private var parsedTags: [String] {
        tagsText
            .split(whereSeparator: { $0 == "," || $0 == "\n" })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    private func addFolder() async {
        let name = trimmedFolderName
        guard !name.isEmpty else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let folder = try await model.client.createFolder(name: name)
            folders.append(folder)
            folderId = folder.id
            newFolderName = ""
            errorMessage = nil
        } catch {
            errorMessage = message(for: error, fallback: "폴더를 만들지 못했습니다")
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await model.client.organizeSession(id: session.id, folderId: folderId, tags: parsedTags)
            await onSaved()
            dismiss()
        } catch {
            errorMessage = message(for: error, fallback: "저장하지 못했습니다")
        }
    }

    /// 서버가 준 사유(같은 이름·폴더 상한 등)가 있으면 그대로 보인다
    private func message(for error: Error, fallback: String) -> String {
        if case OpenMakeAPIError.server(_, _, let message?) = error { return message }
        return fallback
    }
}

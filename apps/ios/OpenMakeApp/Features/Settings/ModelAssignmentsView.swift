// 모델 배정 — 웹 settings/model-assignments-section.tsx 대응(역할·기능을 합친 슬롯, 그룹 3개).
// 배정은 서버(model_assignments)에 저장되므로 웹·iOS 어느 쪽에서 바꿔도 같은 채팅에 적용된다.
import SwiftUI
import OpenMakeKit

struct ModelAssignmentsView: View {
    @Environment(AppModel.self) private var model
    @State private var data: ModelAssignments?
    @State private var loadError: String?
    @State private var saveError: String?
    @State private var busy: String?

    private var models: [OpenMakeClient.ModelEntry] {
        (model.modelCatalog?.models ?? []).filter { $0.available != false }
    }

    var body: some View {
        List {
            Section {
                Text("대화·에이전트, 검증·코드, 계획·미디어 작업을 어느 모델이 처리할지 정합니다. 외부 모델은 게이트웨이에 편입된 provider 만 배정할 수 있고, 미배정 항목은 전역 설정 또는 기본값을 따릅니다.")
                    .font(.footnote)
                    .foregroundStyle(Instrument.muted)
            }
            if let data {
                ForEach(data.grouped(), id: \.group) { entry in
                    Section {
                        ForEach(entry.slots) { slot in
                            slotRow(slot, data: data)
                        }
                    } header: {
                        Text(ModelSlotCatalog.groupTitle(entry.group))
                    } footer: {
                        Text(ModelSlotCatalog.groupDescriptions[entry.group] ?? "")
                    }
                }
            } else if let loadError {
                Section { Text(loadError).foregroundStyle(Instrument.danger) }
            } else {
                Section { ProgressView("모델 배정 불러오는 중…") }
            }
            if let saveError {
                Section { Text(saveError).foregroundStyle(Instrument.danger) }
            }
        }
        .navigationTitle("모델 배정")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder
    private func slotRow(_ slot: ModelSlotInfo, data: ModelAssignments) -> some View {
        let current = data.assignment(for: slot.id)?.fullId ?? ""
        VStack(alignment: .leading, spacing: 4) {
            Picker(selection: Binding(
                get: { current },
                set: { newValue in Task { await assign(slot.id, fullId: newValue) } }
            )) {
                Text("기본(자동)").tag("")
                ForEach(models, id: \.modelId) { entry in
                    Text(entry.name).tag(entry.modelId)
                }
                if !current.isEmpty, !models.contains(where: { $0.modelId == current }) {
                    Text("\(current) (목록에 없음)").tag(current)
                }
            } label: {
                HStack(spacing: 6) {
                    Text(ModelSlotCatalog.title(slot.id))
                        .font(.system(size: 14))
                    if !slot.available {
                        badge("사용 불가", color: Instrument.warn)
                    } else if !current.isEmpty {
                        badge("배정됨", color: Instrument.accent)
                    }
                    if busy == slot.id { ProgressView().controlSize(.small) }
                }
            }
            .disabled(busy != nil || !slot.available)
            Text(ModelSlotCatalog.description(slot.id))
                .font(.system(size: 11.5))
                .foregroundStyle(Instrument.faint)
                .lineLimit(2)
            if let eff = data.effective(for: slot.id) {
                Text(effectiveText(eff))
                    .font(.system(size: 11.5))
                    .foregroundStyle(eff.error == nil ? Instrument.muted : Instrument.warn)
                    .lineLimit(2)
            }
        }
    }

    private func badge(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.12), in: Capsule())
    }

    private func effectiveText(_ eff: ModelSlotEffective) -> String {
        if let error = eff.error {
            return "실효: 사용 불가 — \(error)"
        }
        let source: String = switch eff.source {
        case "user": "내 배정"
        case "global": "전역 설정"
        case "default": "기본값"
        default: ""
        }
        let id = eff.fullId ?? "미배정"
        return source.isEmpty ? "실효: \(id)" : "실효: \(id) (\(source))"
    }

    private func load() async {
        loadError = nil
        if model.modelCatalog == nil { await model.loadCatalog() }
        do {
            data = try await model.client.modelAssignments()
        } catch {
            loadError = "모델 배정을 불러오지 못했습니다."
        }
    }

    /// 빈 값이면 해제(전역/기본값으로 복귀). 실패하면 오류를 남기고 다시 읽는다.
    private func assign(_ slot: String, fullId: String) async {
        busy = slot
        saveError = nil
        defer { busy = nil }
        do {
            if fullId.isEmpty {
                try await model.client.clearModelAssignment(slot: slot)
            } else {
                try await model.client.assignModel(slot: slot, fullId: fullId)
            }
        } catch let error as OpenMakeAPIError {
            if case .server(_, _, let message) = error, let message, !message.isEmpty {
                saveError = "\(ModelSlotCatalog.title(slot)): \(message)"
            } else {
                saveError = "모델 배정 저장에 실패했습니다."
            }
        } catch {
            saveError = "모델 배정 저장에 실패했습니다."
        }
        data = (try? await model.client.modelAssignments()) ?? data
    }
}

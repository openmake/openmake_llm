// 기능별 모델 배정 — 웹 settings/capability-groups.tsx 대응(6그룹 + 세부 설정).
// 배정은 서버(capability_models)에 저장되므로 웹·iOS 어느 쪽에서 바꿔도 같은 채팅에 적용된다.
import SwiftUI
import OpenMakeKit

struct CapabilityModelsView: View {
    @Environment(AppModel.self) private var model
    @State private var data: CapabilityModels?
    @State private var loadError: String?
    @State private var saveError: String?
    @State private var busy: String?
    @State private var expanded: Set<String> = []

    /// 그룹 안 capability 의 배정이 서로 다를 때의 표시값
    private static let mixed = "__mixed__"

    private var isAdmin: Bool {
        if case .loggedIn(let user) = model.authState { return user.role.rawValue == "admin" }
        return false
    }

    private var models: [OpenMakeClient.ModelEntry] {
        (model.modelCatalog?.models ?? []).filter { $0.available != false }
    }

    var body: some View {
        List {
            Section {
                Text("질문을 분석한 Planner 가 계획한 기능(이미지·영상·음성 등)을 어느 모델이 처리할지 정합니다. 외부 모델은 게이트웨이에 편입된 provider 만 배정할 수 있고, 미배정 항목은 전역 설정 또는 기본값을 따릅니다.")
                    .font(.footnote)
                    .foregroundStyle(Instrument.muted)
            }
            if let data {
                let resolved = CapabilityCatalog.resolveGroups(assignable: data.assignable, admin: isAdmin)
                ForEach(resolved.groups) { group in
                    groupSection(group, data: data)
                }
                if !resolved.hiddenUnsupported.isEmpty {
                    Section {
                        Text("아직 실행 경로가 없는 기능은 표시하지 않습니다: \(resolved.hiddenUnsupported.map(CapabilityCatalog.label).joined(separator: ", "))")
                            .font(.footnote)
                            .foregroundStyle(Instrument.faint)
                    }
                }
            } else if let loadError {
                Section { Text(loadError).foregroundStyle(Instrument.danger) }
            } else {
                Section { ProgressView("기능 배정 불러오는 중…") }
            }
            if let saveError {
                Section { Text(saveError).foregroundStyle(Instrument.danger) }
            }
        }
        .navigationTitle("기능별 모델 배정")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder
    private func groupSection(_ group: CapabilityCatalog.Group, data: CapabilityModels) -> some View {
        let groupValue = groupSelection(group, data: data)
        let isMixed = groupValue == Self.mixed
        Section {
            Picker(selection: Binding(
                get: { groupValue },
                set: { newValue in
                    guard newValue != Self.mixed else { return }
                    Task { await assign(group.members, fullId: newValue, key: group.id) }
                }
            )) {
                Text("기본(자동)").tag("")
                ForEach(models, id: \.modelId) { entry in
                    Text(entry.name).tag(entry.modelId)
                }
                if isMixed { Text("(개별 설정)").tag(Self.mixed) }
                if !groupValue.isEmpty, !isMixed, !models.contains(where: { $0.modelId == groupValue }) {
                    Text("\(groupValue) (목록에 없음)").tag(groupValue)
                }
            } label: {
                HStack(spacing: 6) {
                    Text(group.title)
                    if group.isUnsupported {
                        badge("현재 미지원", color: Instrument.warn)
                    } else if !groupValue.isEmpty {
                        badge("배정됨", color: Instrument.accent)
                    }
                    if busy == group.id { ProgressView().controlSize(.small) }
                }
            }
            .disabled(busy != nil)

            if isMixed || expanded.contains(group.id) || group.members.count > 1 && expanded.contains(group.id) {
                ForEach(group.members, id: \.self) { capability in
                    capabilityRow(capability, data: data)
                }
            }
            if group.members.count > 1 {
                Button(expanded.contains(group.id) ? "세부 설정 닫기" : "세부 설정") {
                    if expanded.contains(group.id) { expanded.remove(group.id) } else { expanded.insert(group.id) }
                }
                .font(.footnote)
                .tint(Instrument.accent)
            }
        } header: {
            Text(group.title)
        } footer: {
            Text(group.description)
        }
    }

    @ViewBuilder
    private func capabilityRow(_ capability: String, data: CapabilityModels) -> some View {
        let current = data.override(for: capability)?.fullId ?? ""
        VStack(alignment: .leading, spacing: 4) {
            Picker(selection: Binding(
                get: { current },
                set: { newValue in Task { await assign([capability], fullId: newValue, key: capability) } }
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
                    Text(CapabilityCatalog.label(capability))
                        .font(.system(size: 14))
                    if CapabilityCatalog.unsupported.contains(capability) {
                        badge("미지원", color: Instrument.warn)
                    }
                    if busy == capability { ProgressView().controlSize(.small) }
                }
            }
            .disabled(busy != nil)
            if let eff = data.effective(for: capability) {
                Text(effectiveText(eff))
                    .font(.system(size: 11.5))
                    .foregroundStyle(eff.error == nil ? Instrument.muted : Instrument.warn)
                    .lineLimit(2)
            }
        }
        .padding(.leading, 8)
    }

    private func badge(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.12), in: Capsule())
    }

    private func groupSelection(_ group: CapabilityCatalog.Group, data: CapabilityModels) -> String {
        let values = group.members.map { data.override(for: $0)?.fullId ?? "" }
        guard let first = values.first else { return "" }
        return values.allSatisfy { $0 == first } ? first : Self.mixed
    }

    private func effectiveText(_ eff: CapabilityEffective) -> String {
        if let error = eff.error {
            return "실효: 사용 불가 — \(error)"
        }
        let source: String = switch eff.source {
        case "user": "내 배정"
        case "global": "전역 설정"
        case "default": "기본값"
        default: eff.source ?? ""
        }
        let id = eff.fullId ?? "미배정"
        return source.isEmpty ? "실효: \(id)" : "실효: \(id) (\(source))"
    }

    private func load() async {
        loadError = nil
        if model.modelCatalog == nil { await model.loadCatalog() }
        do {
            data = try await model.client.capabilityModels()
        } catch {
            loadError = "기능 배정을 불러오지 못했습니다."
        }
    }

    /// 그룹 선택 → 멤버 전부 배정(빈 값이면 해제). 하나라도 실패하면 오류를 남기고 다시 읽는다.
    private func assign(_ capabilities: [String], fullId: String, key: String) async {
        busy = key
        saveError = nil
        defer { busy = nil }
        for capability in capabilities {
            do {
                if fullId.isEmpty {
                    try await model.client.clearCapabilityModel(capability)
                } else {
                    try await model.client.assignCapabilityModel(capability, fullId: fullId)
                }
            } catch let error as OpenMakeAPIError {
                if case .server(_, _, let message) = error, let message, !message.isEmpty {
                    saveError = "\(CapabilityCatalog.label(capability)): \(message)"
                } else {
                    saveError = "기능 배정 저장에 실패했습니다."
                }
            } catch {
                saveError = "기능 배정 저장에 실패했습니다."
            }
        }
        data = (try? await model.client.capabilityModels()) ?? data
    }
}

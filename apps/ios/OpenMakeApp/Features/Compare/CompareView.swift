// 모델 비교 모드 — 두 모델이 같은 질문에 동시에 답한다(웹 /compare 대응, 2026-09-12 iOS 격차).
// 입력창은 하나, 전송 한 번이 두 레인에 같은 프롬프트를 싣는다. 폰에서는 위·아래로 나눈다.
import SwiftUI
import OpenMakeKit

struct CompareView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("compare.modelA") private var modelA = ""
    @AppStorage("compare.modelB") private var modelB = ""
    @AppStorage("compare.thinking") private var thinking = false
    @State private var laneA: CompareLaneModel?
    @State private var laneB: CompareLaneModel?
    @State private var draft = ""

    private var isStreaming: Bool { (laneA?.isStreaming ?? false) || (laneB?.isStreaming ?? false) }

    var body: some View {
        VStack(spacing: 0) {
            pickers
            Divider().overlay(Instrument.border)
            if let laneA, let laneB {
                GeometryReader { proxy in
                    VStack(spacing: 0) {
                        LanePane(lane: laneA, title: "A", modelId: modelA, fallback: model.modelCatalog?.defaultModel)
                            .frame(height: proxy.size.height / 2)
                        Divider().overlay(Instrument.borderStrong)
                        LanePane(lane: laneB, title: "B", modelId: modelB, fallback: model.modelCatalog?.defaultModel)
                            .frame(height: proxy.size.height / 2)
                    }
                }
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            composer
        }
        .background(Instrument.bg)
        .navigationTitle("모델 비교")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("새 비교", systemImage: "arrow.counterclockwise") {
                    laneA?.reset()
                    laneB?.reset()
                }
                .disabled(isStreaming)
            }
        }
        .task {
            if laneA == nil {
                laneA = CompareLaneModel(lane: "a", client: model.client, serverURL: AppConfig.serverURL)
                laneB = CompareLaneModel(lane: "b", client: model.client, serverURL: AppConfig.serverURL)
            }
            if model.modelCatalog == nil { await model.loadCatalog() }
        }
        .onDisappear {
            laneA?.teardown()
            laneB?.teardown()
        }
    }

    private var pickers: some View {
        HStack(spacing: 8) {
            ModelPickerMenu(label: "A", selection: $modelA, catalog: model.modelCatalog)
            ModelPickerMenu(label: "B", selection: $modelB, catalog: model.modelCatalog)
            Button {
                thinking.toggle()
            } label: {
                Image(systemName: "brain")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(thinking ? Instrument.accent : Instrument.muted)
                    .frame(width: 34, height: 34)
                    .background(thinking ? Instrument.accentSoft : Instrument.surface2, in: RoundedRectangle(cornerRadius: 10))
            }
            .accessibilityLabel(thinking ? "추론 끄기" : "추론 켜기")
            .accessibilityValue(thinking ? "켜짐" : "꺼짐")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField("두 모델에게 같은 질문", text: $draft, axis: .vertical)
                .font(.system(size: 15))
                .lineLimit(1...4)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Instrument.surface, in: RoundedRectangle(cornerRadius: 20))
                .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Instrument.border))
            if isStreaming {
                Button {
                    Task {
                        await laneA?.stop()
                        await laneB?.stop()
                    }
                } label: {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Instrument.muted)
                        .frame(width: 38, height: 38)
                        .background(Instrument.surface2, in: Circle())
                }
                .accessibilityLabel("응답 중단")
            } else {
                Button(action: submit) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(canSend ? Instrument.accentFg : Instrument.faint)
                        .frame(width: 38, height: 38)
                        .background(canSend ? Instrument.accent : Instrument.surface3, in: Circle())
                }
                .disabled(!canSend)
                .accessibilityLabel("보내기")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Instrument.bg)
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && laneA != nil
    }

    private func submit() {
        let prompt = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty, let laneA, let laneB else { return }
        draft = ""
        let a = modelA.isEmpty ? nil : modelA
        let b = modelB.isEmpty ? nil : modelB
        let think = thinking
        // 같은 틱에 두 레인 전송 — 서버는 lane 으로 스트림을 구분한다
        Task { await laneA.send(prompt, model: a, thinking: think) }
        Task { await laneB.send(prompt, model: b, thinking: think) }
    }
}

private struct ModelPickerMenu: View {
    let label: String
    @Binding var selection: String
    let catalog: ModelCatalog?

    private var title: String {
        if selection.isEmpty { return "기본" }
        return catalog?.models.first { $0.modelId == selection }?.name ?? shortName(selection)
    }

    var body: some View {
        Menu {
            Button {
                selection = ""
            } label: {
                if selection.isEmpty { Label("기본(서버 기본 모델)", systemImage: "checkmark") } else { Text("기본(서버 기본 모델)") }
            }
            if let catalog {
                ForEach(catalog.models.filter { $0.available != false }, id: \.modelId) { entry in
                    Button {
                        selection = entry.modelId
                    } label: {
                        if selection == entry.modelId { Label(entry.name, systemImage: "checkmark") } else { Text(entry.name) }
                    }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(label)
                    .font(Instrument.mono(size: 11, weight: .semibold))
                    .foregroundStyle(Instrument.accent)
                Text(title)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(Instrument.fg)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(Instrument.faint)
            }
            .padding(.horizontal, 10)
            .frame(height: 34)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Instrument.surface, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Instrument.border))
        }
        .accessibilityLabel("모델 \(label) 선택")
        .accessibilityValue(title)
    }

    private func shortName(_ id: String) -> String {
        id.split(separator: ":").last.map(String.init) ?? id
    }
}

private struct LanePane: View {
    @Bindable var lane: CompareLaneModel
    let title: String
    let modelId: String
    let fallback: String?

    private var headerModel: String {
        let served = lane.lastServedModel
        let chosen = modelId.isEmpty ? (fallback ?? "기본") : modelId
        let base = chosen.split(separator: ":").last.map(String.init) ?? chosen
        if let served, served != chosen {
            let servedShort = served.split(separator: ":").last.map(String.init) ?? served
            return "\(base) → \(servedShort) 로 응답"
        }
        return base
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text(title)
                    .font(Instrument.mono(size: 11, weight: .semibold))
                    .foregroundStyle(Instrument.accent)
                Text(headerModel)
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(Instrument.muted)
                    .lineLimit(1)
                Spacer()
                if lane.isStreaming {
                    LumenDot(color: Instrument.accent, size: 6, pulsing: true)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Instrument.surface2)

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if lane.messages.isEmpty {
                            Text("여기에 \(title) 모델의 답이 표시됩니다")
                                .font(.system(size: 12.5))
                                .foregroundStyle(Instrument.faint)
                                .padding(.top, 20)
                                .frame(maxWidth: .infinity)
                        }
                        ForEach(lane.messages) { message in
                            if message.role == "user" {
                                HStack {
                                    Spacer(minLength: 40)
                                    Text(message.content)
                                        .font(.system(size: 13.5))
                                        .foregroundStyle(Instrument.fg)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 7)
                                        .background(Instrument.surface2, in: RoundedRectangle(cornerRadius: 14))
                                }
                            } else {
                                VStack(alignment: .leading, spacing: 6) {
                                    if !message.thinking.isEmpty {
                                        DisclosureGroup {
                                            Text(message.thinking)
                                                .font(.system(size: 12))
                                                .foregroundStyle(Instrument.muted)
                                                .textSelection(.enabled)
                                        } label: {
                                            Text("추론 과정")
                                                .font(.system(size: 11.5, weight: .medium))
                                                .foregroundStyle(Instrument.muted)
                                        }
                                        .tint(Instrument.muted)
                                    }
                                    if message.content.isEmpty && message.isStreaming {
                                        ActivityStatusLine(text: message.thinking.isEmpty ? "응답을 기다리고 있어요" : "답변을 생각하고 있어요", kind: .thinking)
                                    } else {
                                        MarkdownText(content: message.content + (message.isStreaming ? " ▍" : ""))
                                    }
                                    if let error = message.error {
                                        Text(error)
                                            .font(.footnote)
                                            .foregroundStyle(Instrument.danger)
                                    }
                                }
                            }
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(12)
                }
                .onChange(of: lane.messages.last?.content) {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
        }
    }
}

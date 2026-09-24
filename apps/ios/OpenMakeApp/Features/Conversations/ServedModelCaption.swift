// 실제로 답한(처리한) 모델 캡션 — 선택 모델이 아니라 서버가 알려준 served model(자동 선택·쿼터 강등·폴백 반영).
// 카탈로그에 표시 이름이 있으면 이름, 없으면 id 그대로(웹 ServedModelBadge 대응).
import SwiftUI
import OpenMakeKit

struct ServedModelCaption: View {
    @Environment(AppModel.self) private var app
    let model: String
    var prefix = "답변 모델"

    private var label: String { app.modelCatalog?.displayName(for: model) ?? model }

    var body: some View {
        Label(label, systemImage: "cpu")
            .font(Instrument.mono(size: 11))
            .foregroundStyle(Instrument.muted)
            .lineLimit(1)
            .truncationMode(.middle)
            .accessibilityLabel("\(prefix): \(label)")
    }
}

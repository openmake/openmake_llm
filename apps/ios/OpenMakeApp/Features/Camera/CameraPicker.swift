// 카메라 촬영 첨부 (폰 기능 3단계) — 촬영 이미지를 기존 vision 채널(dataURL images[])로.
//
// PhotosPicker(라이브러리)와 달리 즉석 촬영용. SwiftUI 네이티브 카메라 API 가 없어
// UIImagePickerController(.camera) 를 래핑한다. 시뮬레이터는 카메라가 없으므로
// 호출부가 isCameraAvailable 로 메뉴 노출을 가드한다.
import SwiftUI
import UIKit

struct CameraPicker: UIViewControllerRepresentable {
    /// 촬영 완료 시 JPEG 데이터 전달 (취소 시 미호출)
    let onCapture: (Data) -> Void
    @Environment(\.dismiss) private var dismiss

    static var isCameraAvailable: Bool {
        UIImagePickerController.isSourceTypeAvailable(.camera)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            // vision 입력엔 원본 해상도가 과함 — 긴 변 1568(모델 권장 상한 축)으로 축소 후 JPEG.
            if let image = info[.originalImage] as? UIImage,
               let data = image.resized(maxDimension: 1568).jpegData(compressionQuality: 0.8) {
                parent.onCapture(data)
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}

private extension UIImage {
    func resized(maxDimension: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        guard longest > maxDimension else { return self }
        let scale = maxDimension / longest
        let newSize = CGSize(width: size.width * scale, height: size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: newSize, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
}

// 로그인 — LUMEN 시안 ① (openmake-ios-lumen/index.html)
import SwiftUI
import AuthenticationServices
import OpenMakeKit

struct LoginView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuth
    @State private var email = ""
    @State private var password = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var providers: [String] = []

    var body: some View {
        VStack(spacing: 12) {
            Spacer()

            // 웹과 동일 로고 (apps/web/public/logo.png — 기어+열쇠구멍)
            Image("logo")
                .resizable()
                .scaledToFit()
                .frame(width: 72, height: 72)
                .padding(.bottom, 6)

            Wordmark(size: 26)
            Text("나의 서버, 나의 AI")
                .font(.footnote)
                .foregroundStyle(Lumen.muted)
                .padding(.bottom, 16)

            VStack(spacing: 12) {
                lumenField {
                    TextField("이메일", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                lumenField {
                    SecureField("비밀번호", text: $password)
                        .textContentType(.password)
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }

            Button {
                Task { await submit() }
            } label: {
                Group {
                    if isLoading {
                        ProgressView().tint(Lumen.accentFg)
                    } else {
                        Text("로그인").fontWeight(.semibold)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Lumen.accent, in: RoundedRectangle(cornerRadius: 14))
                .foregroundStyle(Lumen.accentFg)
            }
            .disabled(isLoading || email.isEmpty || password.isEmpty)
            .opacity(email.isEmpty || password.isEmpty ? 0.5 : 1)

            if providers.contains("google") {
                HStack(spacing: 10) {
                    Rectangle().fill(Lumen.border).frame(height: 1)
                    Text("또는").font(.caption2).foregroundStyle(Lumen.faint)
                    Rectangle().fill(Lumen.border).frame(height: 1)
                }
                .padding(.vertical, 2)

                Button {
                    Task { await googleLogin() }
                } label: {
                    Text("Google로 계속하기")
                        .fontWeight(.medium)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Lumen.surface, in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Lumen.border))
                        .foregroundStyle(Lumen.fg2)
                }
                .disabled(isLoading)
            }

            Spacer()
            Spacer()
        }
        .padding(.horizontal, 24)
        .background(Lumen.bg)
        .task {
            providers = (try? await model.client.oauthProviders()) ?? []
        }
    }

    private func lumenField(@ViewBuilder content: () -> some View) -> some View {
        content()
            .padding(.horizontal, 14)
            .padding(.vertical, 13)
            .background(Lumen.surface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Lumen.border))
    }

    private func submit() async {
        isLoading = true
        defer { isLoading = false }
        errorMessage = nil
        do {
            try await model.login(email: email, password: password)
        } catch let error as OpenMakeAPIError {
            switch error {
            case .server(_, _, let message):
                errorMessage = message ?? "로그인에 실패했습니다"
            case .notAuthenticated:
                errorMessage = "로그인에 실패했습니다"
            case .invalidResponse:
                errorMessage = "서버 응답을 처리할 수 없습니다"
            }
        } catch {
            errorMessage = "네트워크 오류: \(error.localizedDescription)"
        }
    }

    /// Google OAuth (축 2 exchange code 흐름)
    private func googleLogin() async {
        isLoading = true
        defer { isLoading = false }
        errorMessage = nil
        do {
            var components = URLComponents(
                url: AppConfig.serverURL.appending(path: "/api/auth/login/google"),
                resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name: "client", value: "ios")]
            let callback = try await webAuth.authenticate(
                using: components.url!,
                callbackURLScheme: AppConfig.appScheme)
            guard let code = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "code" })?.value else {
                errorMessage = "콜백에서 코드를 찾지 못했습니다"
                return
            }
            try await model.exchangeLogin(code: code)
        } catch is ASWebAuthenticationSessionError {
            // 사용자 취소 — 조용히 무시
        } catch let error as OpenMakeAPIError {
            if case .server(_, _, let message) = error {
                errorMessage = message ?? "토큰 교환에 실패했습니다"
            } else {
                errorMessage = "토큰 교환에 실패했습니다"
            }
        } catch {
            errorMessage = "로그인에 실패했습니다: \(error.localizedDescription)"
        }
    }
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { ApiClient, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/primitives";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!agreedToTerms || !agreedToPrivacy) {
      setError("서비스 이용약관 및 개인정보 처리방침에 동의해야 합니다.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await ApiClient.post("/api/auth/register", {
        username,
        email,
        password,
        birthDate,
        agreedToTerms: true,
        agreedToPrivacy: true,
      });
      router.push("/login");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "회원가입에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center bg-app px-4">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-accent text-xl font-bold text-accent-fg shadow-2">
            O
          </div>
          <h1 className="mt-4 text-2xl font-bold text-fg">OpenMake.Ai</h1>
          <p className="mt-1 text-sm text-muted">계정을 만들고 시작하세요</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="rounded-xl border border-border bg-surface p-6 shadow-2"
        >
          {error && (
            <div className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          <label className="block text-xs font-medium text-fg-2">이름</label>
          <input
            type="text"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="홍길동"
            className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none transition placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-[var(--accent-ring)]"
          />

          <label className="mt-4 block text-xs font-medium text-fg-2">이메일</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none transition placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-[var(--accent-ring)]"
          />

          <label className="mt-4 block text-xs font-medium text-fg-2">비밀번호</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none transition placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-[var(--accent-ring)]"
          />

          <label className="mt-4 block text-xs font-medium text-fg-2">생년월일</label>
          <input
            type="date"
            required
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none transition focus:border-accent focus:ring-2 focus:ring-[var(--accent-ring)]"
          />

          <div className="mt-4 space-y-2.5">
            <label className="flex items-start gap-2.5 text-xs text-fg-2">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-0.5 shrink-0 accent-[var(--accent)]"
              />
              <span>
                <span className="font-medium text-fg">서비스 이용약관</span>에 동의합니다{" "}
                <span className="text-danger">*</span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-xs text-fg-2">
              <input
                type="checkbox"
                checked={agreedToPrivacy}
                onChange={(e) => setAgreedToPrivacy(e.target.checked)}
                className="mt-0.5 shrink-0 accent-[var(--accent)]"
              />
              <span>
                <span className="font-medium text-fg">개인정보 처리방침</span>에 동의합니다{" "}
                <span className="text-danger">*</span>
              </span>
            </label>
          </div>

          <Button type="submit" disabled={loading} className="mt-5 w-full">
            {loading ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <>
                회원가입 <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>

          <p className="mt-4 text-center text-xs text-muted">
            이미 계정이 있으신가요?{" "}
            <Link href="/login" className="font-medium text-accent hover:underline">
              로그인
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

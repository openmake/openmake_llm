import * as React from "react";
import { cn } from "@/lib/utils";

/* ── Button ─────────────────────────────────────────────── */
type ButtonVariant = "default" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "icon" | "icon-sm";

const BTN_VARIANT: Record<ButtonVariant, string> = {
  default:
    "bg-accent text-accent-fg shadow-2 hover:bg-accent-hover active:bg-accent-press",
  outline:
    "border border-border-strong bg-surface text-fg hover:bg-surface-2",
  ghost: "text-fg-2 hover:bg-surface-2 hover:text-fg",
  danger: "bg-danger text-white hover:opacity-90",
};
const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  icon: "h-9 w-9",
  "icon-sm": "h-8 w-8",
};

export function Button({
  variant = "default",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:opacity-40 disabled:pointer-events-none",
        BTN_VARIANT[variant],
        BTN_SIZE[size],
        className,
      )}
      {...props}
    />
  );
}

/* ── Form controls (Input · Textarea · NativeSelect) ────── */
/** 폼 컨트롤 공통 크기 — md(h-9, text-sm)는 일반, sm(h-8, text-xs)은 표/툴바 등 조밀한 맥락. */
type ControlSize = "sm" | "md";
const CONTROL_SIZE: Record<ControlSize, string> = {
  md: "h-9 px-3 text-sm",
  sm: "h-8 px-2.5 text-xs",
};
const CONTROL_BASE =
  "w-full rounded-md border border-border-strong bg-surface text-fg outline-none transition placeholder:text-muted focus:border-accent disabled:opacity-50";

export function Input({
  inputSize = "md",
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { inputSize?: ControlSize }) {
  return (
    <input className={cn(CONTROL_BASE, CONTROL_SIZE[inputSize], className)} {...props} />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(CONTROL_BASE, "resize-y px-3 py-2 text-sm", className)}
      {...props}
    />
  );
}

export function NativeSelect({
  selectSize = "md",
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { selectSize?: ControlSize }) {
  return (
    <select className={cn(CONTROL_BASE, CONTROL_SIZE[selectSize], className)} {...props} />
  );
}

/* ── PageBody ───────────────────────────────────────────── */
/**
 * 워크스페이스 페이지의 스크롤 컨테이너 — layout.tsx 계약(각 페이지가 스크롤 영역을 직접 만든다)에
 * 맞춰 `min-h-0 flex-1 overflow-y-auto p-6` 로 세우고 본문을 `mx-auto w-full max-w-6xl`(1152px)로 가운데 정렬한다.
 * 전 페이지가 같은 최대 폭·24px 패딩을 공유하도록 이 하나를 쓴다(채팅·비교 등 full-bleed 화면 제외).
 * className 은 안쪽 폭 컨테이너에 붙는다(space-y-* 등 본문 간격 지정용).
 */
export function PageBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className={cn("mx-auto w-full max-w-6xl", className)}>{children}</div>
    </div>
  );
}

/* ── Card ───────────────────────────────────────────────── */
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface shadow-1 overflow-hidden",
        className,
      )}
      {...props}
    />
  );
}
export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-border px-5 py-4", className)} {...props} />;
}
export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold text-fg", className)} {...props} />;
}
export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

/* ── Badge ──────────────────────────────────────────────── */
type BadgeTone = "accent" | "success" | "warn" | "danger" | "neutral";
const BADGE_TONE: Record<BadgeTone, string> = {
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-surface-3 text-muted",
};
export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-medium",
        BADGE_TONE[tone],
        className,
      )}
      {...props}
    />
  );
}

/* ── PageHeader ─────────────────────────────────────────── */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-bold text-fg">{title}</h1>
        {description && <p className="mt-1 truncate text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ── StatCard ───────────────────────────────────────────── */
export function StatCard({
  label,
  value,
  delta,
  deltaTone = "success",
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "success" | "danger";
}) {
  return (
    <Card className="p-5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-fg">{value}</p>
      {delta && (
        <p
          className={cn(
            "mt-1 text-xs font-medium",
            deltaTone === "success" ? "text-success" : "text-danger",
          )}
        >
          {delta}
        </p>
      )}
    </Card>
  );
}

/* ── Table ──────────────────────────────────────────────── */
export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">{children}</table>
    </div>
  );
}
export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "border-b border-border px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-faint",
        className,
      )}
      {...props}
    />
  );
}
export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("border-b border-border px-3 py-2.5 text-fg-2", className)} {...props} />
  );
}

/* ── 대화상자 접근성 (F19.8) ─────────────────────────────── */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 모달 포커스 트랩 — 열리면 안으로 포커스를 옮기고(autoFocus 가 이미 안에 있으면 유지) Tab 순환을 가두며,
 * Escape 로 onClose, 닫히면 열기 전 포커스로 되돌린다. 반환 ref 를 모달 패널에 붙인다(패널엔 tabIndex={-1}).
 * 키 처리는 패널 노드에서 받는다 — 중첩 모달은 안쪽이 먼저 처리하고 전파를 멈춘다.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean, onClose?: () => void) {
  const ref = React.useRef<T>(null);
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.getClientRects().length > 0 || el === document.activeElement,
      );
    if (!node.contains(document.activeElement)) (focusables()[0] ?? node).focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onCloseRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        node.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || current === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [active]);

  return ref;
}

/**
 * 모달 대화상자 — 배경 클릭·Escape 닫기, focus trap, role=dialog·aria-modal. 새 모달은 이것을 쓴다.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  /** 스크린리더 이름(aria-label)과 머리글 */
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const panelRef = useFocusTrap<HTMLDivElement>(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn("w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl outline-none", className)}
      >
        <h2 className="mb-3 text-base font-semibold text-fg">{title}</h2>
        {children}
      </div>
    </div>
  );
}

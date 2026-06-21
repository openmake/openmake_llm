import { MessageList } from "@/components/chat/message-list";
import { Composer } from "@/components/chat/composer";

export default function ChatPage() {
  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-border px-5">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-fg">새 대화</h1>
          <p className="truncate text-xs text-faint">워크스페이스 · 채팅</p>
        </div>
        <span className="shrink-0 rounded-md bg-surface-2 px-2 py-1 font-mono text-xs text-muted">
          Lumen
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageList />
      </div>

      <Composer />
    </>
  );
}

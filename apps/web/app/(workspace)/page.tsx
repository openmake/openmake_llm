import { MessageList } from "@/components/chat/message-list";
import { ActiveContext } from "@/components/chat/active-context";
import { Composer } from "@/components/chat/composer";
import { ArtifactPanel } from "@/components/chat/artifact-panel";
import { ArtifactToggle } from "@/components/chat/artifact-toggle";

export default function ChatPage() {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border px-5">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-fg">새 대화</h1>
            <p className="truncate text-xs text-faint">워크스페이스 · 채팅</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ArtifactToggle />
            <span className="rounded-md bg-surface-2 px-2 py-1 font-mono text-xs text-muted">
              Lumen
            </span>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <MessageList />
        </div>

        <ActiveContext />
        <Composer />
      </div>

      <ArtifactPanel />
    </div>
  );
}

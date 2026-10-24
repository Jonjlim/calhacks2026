import type { ChatMessage, Participant } from "@/lib/contracts";
import { Panel } from "@/components/ui/Panel";

// PX-003: transcript + composer. Agent and human messages must look distinct.
export function ChatPanel({
  messages,
  participants,
}: {
  messages: ChatMessage[];
  participants: Participant[];
}) {
  const nameOf = (id?: string) => participants.find((p) => p.id === id)?.displayName ?? "Someone";
  return (
    <Panel title="Room chat">
      <ul className="flex flex-col gap-2">
        {messages.map((m) => (
          <li
            key={m.id}
            className={m.authorKind === "buyer_agent" ? "rounded bg-plum/5 p-2 italic" : "p-2"}
          >
            <span className="font-medium">
              {m.authorKind === "buyer_agent" ? "Unwrap" : nameOf(m.participantId)}:
            </span>{" "}
            {m.body}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

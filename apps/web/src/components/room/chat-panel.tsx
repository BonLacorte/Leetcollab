import { useState, type FormEvent } from "react";
import type { RoomPermissions, RoomState } from "@leetcollab/contracts";

const permissionOptions: Array<[keyof RoomPermissions, string]> = [
  ["canEditCode", "Edit code"],
  ["canDrawWhiteboard", "Use whiteboard"],
  ["canChangeProblem", "Change problem"],
  ["canChat", "Send chat"],
];

type ChatPanelProps = {
  room: RoomState;
  message: string;
  canChat: boolean;
  isHost: boolean;
  onMessageChange: (value: string) => void;
  onSendMessage: (event: FormEvent) => void;
  onMemberPermissionChange: (
    memberUserId: string,
    capability: keyof RoomPermissions,
    enabled: boolean,
  ) => void;
};

export function ChatPanel({
  room,
  message,
  canChat,
  isHost,
  onMessageChange,
  onSendMessage,
  onMemberPermissionChange,
}: ChatPanelProps) {
  const [activeTab, setActiveTab] = useState<"chat" | "members">("chat");

  return (
    <aside className="workspace-card conversation-panel">
      <div className="tabs" role="tablist" aria-label="Conversation">
        <button className={activeTab === "chat" ? "active" : ""} onClick={() => setActiveTab("chat")} type="button">Chat</button>
        <button className={activeTab === "members" ? "active" : ""} onClick={() => setActiveTab("members")} type="button">Members</button>
      </div>

      {activeTab === "chat" ? (
        <div className="chat-layout">
          <div className="messages">
            {room.messages.length === 0 ? (
              <p className="muted">No messages yet.</p>
            ) : room.messages.map((item) => (
              <div className="message" key={item.id}>
                <strong>{item.username}</strong>
                <span>{item.body}</span>
              </div>
            ))}
          </div>
          <form className="chat-form" onSubmit={onSendMessage}>
            <input
              value={message}
              disabled={!canChat}
              onChange={(event) => onMessageChange(event.target.value)}
              placeholder={canChat ? "Type a message..." : "Chat permission disabled"}
              maxLength={2000}
            />
            <button disabled={!canChat} type="submit">Send</button>
          </form>
        </div>
      ) : (
        <div className="member-list">
          {room.members.map((member) => (
            <div className="member-card" key={member.userId}>
              <div className="member-row">
                <strong>{member.username}</strong>
                {member.userId === room.hostUserId && <span className="host-badge">Host</span>}
              </div>
              {isHost && member.userId !== room.hostUserId && (
                <div className="permission-grid">
                  {permissionOptions.map(([capability, label]) => (
                    <label key={capability} className="permission-toggle">
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={member.permissions[capability]}
                        onChange={(event) => onMemberPermissionChange(member.userId, capability, event.target.checked)}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

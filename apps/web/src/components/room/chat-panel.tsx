import { useEffect, useRef, useState, type FormEvent } from "react";
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
  currentUserId: string;
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
  currentUserId,
  canChat,
  isHost,
  onMessageChange,
  onSendMessage,
  onMemberPermissionChange,
}: ChatPanelProps) {
  const [activeTab, setActiveTab] = useState<"chat" | "members">("chat");
  const [settingsMemberId, setSettingsMemberId] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const settingsMember = room.members.find((member) => member.userId === settingsMemberId);

  useEffect(() => {
    const messagesElement = messagesRef.current;
    if (!messagesElement || !shouldStickToBottomRef.current) return;

    messagesElement.scrollTop = messagesElement.scrollHeight;
  }, [room.messages.length]);

  function formatTime(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  }

  function dateKey(value: string): string {
    return new Date(value).toDateString();
  }

  function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
    }).format(new Date(value));
  }

  function handleMessagesScroll() {
    const messagesElement = messagesRef.current;
    if (!messagesElement) return;

    const distanceFromBottom = messagesElement.scrollHeight
      - messagesElement.scrollTop
      - messagesElement.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 80;
  }

  return (
    <aside className="workspace-card conversation-panel">
      <div className="tabs" role="tablist" aria-label="Conversation">
        <button className={activeTab === "chat" ? "active" : ""} onClick={() => setActiveTab("chat")} type="button">Chat</button>
        <button className={activeTab === "members" ? "active" : ""} onClick={() => setActiveTab("members")} type="button">Members</button>
      </div>

      {activeTab === "chat" ? (
        <div className="chat-layout">
          <div className="messages" ref={messagesRef} onScroll={handleMessagesScroll}>
            {room.messages.length === 0 ? (
              <p className="muted">No messages yet.</p>
            ) : room.messages.map((item, index) => {
              const previousMessage = room.messages[index - 1];
              const showDateSeparator = !previousMessage
                || dateKey(previousMessage.sentAt) !== dateKey(item.sentAt);
              const isSystem = item.type === "system";
              const isMine = item.type === "user" && item.userId === currentUserId;

              return (
                <div className="message-block" key={item.id}>
                  {showDateSeparator && (
                    <div className="message-date-separator">
                      <span>{formatDate(item.sentAt)}</span>
                    </div>
                  )}
                  {isSystem ? (
                    <div className="message system-message">
                      <span>{item.body}</span>
                      <time dateTime={item.sentAt}>{formatTime(item.sentAt)}</time>
                    </div>
                  ) : (
                    <div className={isMine ? "message mine" : "message"}>
                      <div className="message-meta">
                        <strong>{isMine ? "You" : item.username}</strong>
                        <time dateTime={item.sentAt}>{formatTime(item.sentAt)}</time>
                      </div>
                      <span>{item.body}</span>
                    </div>
                  )}
                </div>
              );
            })}
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
                <div className="member-actions">
                  {member.userId === room.hostUserId && <span className="host-badge">Host</span>}
                  {isHost && member.userId !== room.hostUserId && (
                    <button
                      aria-label={`Manage ${member.username} permissions`}
                      className="member-settings-button"
                      onClick={() => setSettingsMemberId(member.userId)}
                      title={`Manage ${member.username} permissions`}
                      type="button"
                    >
                      ⋯
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {isHost && settingsMember && settingsMember.userId !== room.hostUserId && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSettingsMemberId(null)}>
          <div
            aria-labelledby="member-permissions-title"
            aria-modal="true"
            className="member-permissions-modal"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Member settings</p>
                <h2 id="member-permissions-title">{settingsMember.username}</h2>
              </div>
              <button
                aria-label="Close member settings"
                className="member-settings-button"
                onClick={() => setSettingsMemberId(null)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="permission-grid">
              {permissionOptions.map(([capability, label]) => (
                <label key={capability} className="permission-toggle">
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    checked={settingsMember.permissions[capability]}
                    onChange={(event) => onMemberPermissionChange(settingsMember.userId, capability, event.target.checked)}
                  />
                </label>
              ))}
            </div>
            <button className="secondary" onClick={() => setSettingsMemberId(null)} type="button">Done</button>
          </div>
        </div>
      )}
    </aside>
  );
}

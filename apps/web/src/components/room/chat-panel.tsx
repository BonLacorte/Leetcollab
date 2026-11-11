import { useEffect, useRef, useState, type FormEvent } from "react";
import type { RoomPermissions, RoomState } from "@leetcollab/contracts";
import { Send, Settings2 } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

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
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
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
    <Card className="workspace-card conversation-panel">
      <Tabs
        className="conversation-tabs"
        onValueChange={(value) => setActiveTab(value as "chat" | "members")}
        value={activeTab}
      >
        <TabsList aria-label="Conversation">
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>

        <TabsContent className="chat-layout" value="chat">
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
            <Input
              aria-label="Chat message"
              value={message}
              disabled={!canChat}
              onChange={(event) => onMessageChange(event.target.value)}
              placeholder={canChat ? "Type a message..." : "Chat permission disabled"}
              maxLength={2000}
            />
            <Button aria-label="Send message" disabled={!canChat} type="submit">
              <Send aria-hidden="true" />
              Send
            </Button>
          </form>
        </TabsContent>

        <TabsContent className="member-list" value="members">
          {room.members.map((member) => (
            <Card className="member-card" key={member.userId}>
              <div className="member-row">
                <strong>{member.username}</strong>
                <div className="member-actions">
                  {member.userId === room.hostUserId && <Badge variant="secondary">Host</Badge>}
                  {isHost && member.userId !== room.hostUserId && (
                    <Button
                      aria-label={`Manage ${member.username} permissions`}
                      onClick={(event) => {
                        settingsTriggerRef.current = event.currentTarget;
                        setSettingsMemberId(member.userId);
                      }}
                      size="icon"
                      title={`Manage ${member.username} permissions`}
                      variant="ghost"
                    >
                      <Settings2 aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {isHost && settingsMember && settingsMember.userId !== room.hostUserId && (
        <Dialog open onOpenChange={(open) => { if (!open) setSettingsMemberId(null); }}>
          <DialogContent onCloseAutoFocus={(event) => {
            event.preventDefault();
            settingsTriggerRef.current?.focus();
          }}>
            <DialogHeader>
              <p className="eyebrow">Member settings</p>
              <DialogTitle>{settingsMember.username}</DialogTitle>
              <DialogDescription className="sr-only">
                Member settings for {settingsMember.username}
              </DialogDescription>
            </DialogHeader>
            <div className="permission-grid">
              {permissionOptions.map(([capability, label]) => (
                <div key={capability} className="permission-toggle">
                  <Label htmlFor={`permission-${settingsMember.userId}-${capability}`}>{label}</Label>
                  <Checkbox
                    id={`permission-${settingsMember.userId}-${capability}`}
                    checked={settingsMember.permissions[capability]}
                    onCheckedChange={(checked) => onMemberPermissionChange(
                      settingsMember.userId,
                      capability,
                      checked === true,
                    )}
                  />
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={() => setSettingsMemberId(null)} variant="secondary">Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

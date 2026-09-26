import {
  EDIT_WINDOW_MS,
  GROUP_ICONS,
  GROUP_MAX_MEMBERS,
  GROUP_NAME_MAX,
  MESSAGE_MAX,
  type ChatMessage,
  type ConversationSummary,
  type GroupIcon as GroupIconId,
} from "@hearth/shared";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { api } from "../api";
import { describeError } from "../errors";
import { Avatar, GroupIcon, Panel, ReportDialog } from "./bits";
import { useSocial, useSocialStore } from "./context";

interface Props {
  onClose: () => void;
  initialConversation?: string | null;
  onOpenProfile: (handle: string) => void;
}

export function ChatPanel({ onClose, initialConversation = null, onOpenProfile }: Props) {
  const store = useSocialStore();
  const open = useSocial((s) => s.openConversation);
  const [view, setView] = useState<"list" | "new-group">("list");

  useEffect(() => {
    void store.open(initialConversation);
    return () => void store.open(null);
  }, [store, initialConversation]);

  if (open)
    return (
      <Thread
        conversationId={open}
        onBack={() => void store.open(null)}
        onClose={onClose}
        onOpenProfile={onOpenProfile}
      />
    );
  if (view === "new-group")
    return (
      <NewGroup
        onDone={(id) => {
          setView("list");
          void store.open(id);
        }}
        onCancel={() => setView("list")}
        onClose={onClose}
      />
    );
  return <ConversationList onClose={onClose} onNewGroup={() => setView("new-group")} />;
}

export function conversationTitle(c: ConversationSummary, me: string): string {
  if (c.kind === "group") return c.name;
  return c.members.find((m) => m.profile.id !== me)?.profile.displayName ?? "Chat";
}

function ConversationList({ onClose, onNewGroup }: { onClose: () => void; onNewGroup: () => void }) {
  const store = useSocialStore();
  const conversations = useSocial((s) => s.conversations);
  const me = useSocial((s) => s.me);
  return (
    <Panel
      title="Chats"
      onClose={onClose}
      actions={
        <button type="button" className="chip" onClick={onNewGroup}>
          New group
        </button>
      }
    >
      <ul className="list">
        {!conversations.length && (
          <li className="hint">No chats yet. Open a friend's card and choose Message, or start a group.</li>
        )}
        {conversations.map((c) => {
          const other = c.members.find((m) => m.profile.id !== me);
          const last = c.lastMessage;
          const preview = !last
            ? "No messages yet"
            : last.deleted
              ? "Message deleted"
              : `${last.senderId === me ? "You: " : c.kind === "group" ? `${c.members.find((m) => m.profile.id === last.senderId)?.profile.displayName ?? "Someone"}: ` : ""}${last.body}`;
          return (
            <li key={c.id} className="list-row">
              <button type="button" className="row-main" onClick={() => void store.open(c.id)}>
                {c.kind === "group" ? (
                  <GroupIcon icon={c.icon} size={32} />
                ) : (
                  other && <Avatar profile={other.profile} />
                )}
                <span className="ellipsis">
                  {conversationTitle(c, me)}
                  <span className="hint block ellipsis">{preview}</span>
                </span>
              </button>
              {c.unread > 0 && (
                <span className="unread" aria-label={`${c.unread} unread`}>
                  {c.unread}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Thread({
  conversationId,
  onBack,
  onClose,
  onOpenProfile,
}: {
  conversationId: string;
  onBack: () => void;
  onClose: () => void;
  onOpenProfile: (handle: string) => void;
}) {
  const store = useSocialStore();
  const me = useSocial((s) => s.me);
  const conversation = useSocial((s) => s.conversations.find((c) => c.id === conversationId));
  const thread = useSocial((s) => s.threads[conversationId]);
  const typingMap = useSocial((s) => s.typing[conversationId]);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [reporting, setReporting] = useState<ChatMessage | null>(null);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const lastTyping = useRef(0);
  const stickToBottom = useRef(true);

  const profiles = useMemo(
    () => new Map(conversation?.members.map((m) => [m.profile.id, m.profile]) ?? []),
    [conversation],
  );
  const items = thread?.items ?? [];
  const pending = thread?.pending ?? [];
  const typing = Object.entries(typingMap ?? {})
    .filter(([u, until]) => until > Date.now() && u !== me)
    .map(([u]) => profiles.get(u)?.displayName ?? "Someone");

  // Keep the newest message in view unless the reader has scrolled up.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [items.length, pending.length, typing.length]);

  useEffect(() => {
    void store.markRead(conversationId);
  }, [store, conversationId, items.length]);

  if (!conversation) {
    return (
      <Panel title="Chat" onClose={onClose}>
        <button className="chip" onClick={onBack}>
          ◀ Chats
        </button>
        <p className="hint">This chat isn't available.</p>
      </Panel>
    );
  }

  const others = conversation.members.filter((m) => m.profile.id !== me);
  const lastMine = [...items].reverse().find((m) => m.senderId === me && !m.deleted);
  const status = (() => {
    if (!lastMine) return "";
    const read = others.filter((m) => m.readSeq !== null && m.readSeq >= lastMine.seq).length;
    const delivered = others.filter((m) => m.deliveredSeq >= lastMine.seq).length;
    if (conversation.kind === "dm") return read ? "Read" : delivered ? "Delivered" : "Sent";
    return read ? `Read by ${read}` : delivered ? `Delivered to ${delivered}` : "Sent";
  })();

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;
    setError("");
    setText("");
    try {
      if (editing) {
        await store.edit(editing.id, body);
        setEditing(null);
      } else {
        stickToBottom.current = true;
        await store.send(conversationId, body);
      }
    } catch (err) {
      setError(describeError(err));
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
    if (e.key === "Escape" && editing) {
      e.stopPropagation();
      setEditing(null);
      setText("");
    }
  }

  function onChange(value: string) {
    setText(value);
    if (Date.now() - lastTyping.current > 2000 && value.trim()) {
      lastTyping.current = Date.now();
      void api.typing(conversationId).catch(() => undefined);
    }
  }

  const title = conversationTitle(conversation, me);

  return (
    <Panel
      title={title}
      onClose={onClose}
      actions={
        <button type="button" className="chip" onClick={onBack} aria-label="Back to chats">
          ◀
        </button>
      }
    >
      <div className="thread">
        {conversation.kind === "group" && (
          <p className="hint members">
            {conversation.members.map((m) => (
              <button
                key={m.profile.id}
                type="button"
                className="linkish"
                onClick={() => onOpenProfile(m.profile.handle)}
              >
                {m.profile.id === me ? "You" : m.profile.displayName}
              </button>
            ))}
          </p>
        )}
        <ol
          ref={listRef}
          className="messages"
          aria-live="polite"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {thread?.hasOlder && (
            <li className="center">
              <button type="button" className="chip" onClick={() => void store.loadOlder(conversationId)}>
                Load earlier messages
              </button>
            </li>
          )}
          {items.map((m) => {
            const mine = m.senderId === me;
            const sender = m.senderId ? profiles.get(m.senderId) : undefined;
            const canEdit = mine && !m.deleted && Date.now() - Date.parse(m.createdAt) < EDIT_WINDOW_MS;
            return (
              <li key={m.id} className={`msg ${mine ? "mine" : "theirs"}`}>
                {!mine && conversation.kind === "group" && (
                  <span className="msg-sender">{sender?.displayName ?? "Someone"}</span>
                )}
                <div className={`bubble ${m.deleted ? "deleted" : ""}`}>
                  {m.deleted ? "Message deleted" : m.body}
                  {m.editedAt && !m.deleted && <span className="hint"> (edited)</span>}
                </div>
                {!m.deleted && (
                  <button
                    type="button"
                    className="msg-more"
                    aria-label="Message options"
                    aria-expanded={menu === m.id}
                    onClick={() => setMenu(menu === m.id ? null : m.id)}
                  >
                    ⋯
                  </button>
                )}
                {menu === m.id && (
                  <div className="msg-menu" role="menu">
                    {canEdit && (
                      <button
                        role="menuitem"
                        className="chip"
                        onClick={() => {
                          setEditing(m);
                          setText(m.body);
                          setMenu(null);
                        }}
                      >
                        Edit
                      </button>
                    )}
                    {mine && (
                      <button
                        role="menuitem"
                        className="chip"
                        onClick={() => {
                          setMenu(null);
                          void store.remove(m.id).catch((e) => setError(describeError(e)));
                        }}
                      >
                        Delete
                      </button>
                    )}
                    {!mine && sender && (
                      <button
                        role="menuitem"
                        className="chip"
                        onClick={() => {
                          setMenu(null);
                          setReporting(m);
                        }}
                      >
                        Report
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
          {pending.map((p) => (
            <li key={p.id} className="msg mine pending">
              <div className="bubble">{p.body}</div>
              {p.status === "sending" ? (
                <span className="hint">Sending…</span>
              ) : (
                <button
                  type="button"
                  className="linkish error-text"
                  onClick={() => void store.send(conversationId, p.body, p.id).catch(() => undefined)}
                >
                  Not sent. Tap to retry.
                </button>
              )}
            </li>
          ))}
          {status && !pending.length && (
            <li className="msg-status hint" data-testid="receipt">
              {status}
            </li>
          )}
          {typing.length > 0 && (
            <li className="hint typing" data-testid="typing">
              {typing.join(", ")} {typing.length === 1 ? "is" : "are"} typing…
            </li>
          )}
        </ol>
        <p className="error" role="alert">
          {error}
        </p>
        <form className="composer" onSubmit={submit}>
          {editing && (
            <p className="hint">
              Editing message ·{" "}
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  setEditing(null);
                  setText("");
                }}
              >
                cancel
              </button>
            </p>
          )}
          <div className="row nowrap">
            <label className="visually-hidden" htmlFor={`composer-${conversationId}`}>
              Message {title}
            </label>
            <textarea
              id={`composer-${conversationId}`}
              rows={2}
              maxLength={MESSAGE_MAX}
              value={text}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKey}
              placeholder={`Message ${title}`}
            />
            <button type="submit" className="chip send" disabled={!text.trim()}>
              {editing ? "Save" : "Send"}
            </button>
          </div>
          {text.length > MESSAGE_MAX - 200 && (
            <p className="hint">
              {text.length}/{MESSAGE_MAX}
            </p>
          )}
        </form>
      </div>
      {reporting && reporting.senderId && (
        <ReportDialog
          name={profiles.get(reporting.senderId)?.displayName ?? "this message"}
          onClose={() => setReporting(null)}
          onSubmit={(reason, note) =>
            api.report({
              kind: "message",
              targetUserId: reporting.senderId!,
              targetId: reporting.id,
              reason,
              note,
            })
          }
        />
      )}
    </Panel>
  );
}

function NewGroup({
  onDone,
  onCancel,
  onClose,
}: {
  onDone: (id: string) => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const store = useSocialStore();
  const friends = useSocial((s) => s.friends);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<GroupIconId>("star");
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    void store.refreshFriends();
  }, [store]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!picked.length) return setError("Pick at least one friend.");
    try {
      const c = await api.createGroup(name.trim(), icon, picked);
      await store.refreshConversations();
      onDone(c.id);
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <Panel title="New group" onClose={onClose}>
      <form onSubmit={create}>
        <label className="field">
          <span>Group name</span>
          <input value={name} maxLength={GROUP_NAME_MAX} onChange={(e) => setName(e.target.value)} required />
        </label>
        <p className="section-label">Icon</p>
        <div className="swatches" role="group" aria-label="Group icon">
          {GROUP_ICONS.map((i) => (
            <button
              key={i}
              type="button"
              className="swatch icon-swatch"
              aria-pressed={icon === i}
              aria-label={i}
              onClick={() => setIcon(i)}
            >
              <GroupIcon icon={i} size={24} />
            </button>
          ))}
        </div>
        <p className="section-label">
          Friends ({picked.length}/{GROUP_MAX_MEMBERS - 1})
        </p>
        <ul className="list">
          {friends?.friends.map((f) => (
            <li key={f.profile.id}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={picked.includes(f.profile.id)}
                  disabled={!picked.includes(f.profile.id) && picked.length >= GROUP_MAX_MEMBERS - 1}
                  onChange={(e) =>
                    setPicked((p) =>
                      e.target.checked ? [...p, f.profile.id] : p.filter((x) => x !== f.profile.id),
                    )
                  }
                />
                <span>{f.profile.displayName}</span>
              </label>
            </li>
          ))}
          {!friends?.friends.length && <li className="hint">Add some friends first.</li>}
        </ul>
        <p className="error" role="alert">
          {error}
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Create group
          </button>
        </div>
      </form>
    </Panel>
  );
}

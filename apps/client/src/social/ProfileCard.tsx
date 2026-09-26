import type { PublicProfile, Relationship, ReportReason } from "@hearth/shared";
import { useEffect, useState } from "react";
import { ApiFailure, api } from "../api";
import { describeError } from "../errors";
import { Avatar, Modal, PresenceDot, ReportDialog, presenceLabel } from "./bits";
import { useSocial, useSocialStore } from "./context";

interface Props {
  handle: string;
  onClose: () => void;
  /** Opens the chat panel on a conversation. */
  onOpenChat: (conversationId: string) => void;
  /** In the world, Say lines are reported through the room (with the recent conversation attached). */
  reportSay?: (reason: ReportReason, note: string) => Promise<unknown>;
}

/** Someone's card: their character and bio, and what you can do (add, message, mute, block, report). */
export function ProfileCard({ handle, onClose, onOpenChat, reportSay }: Props) {
  const store = useSocialStore();
  const friends = useSocial((s) => s.friends);
  const [data, setData] = useState<{ profile: PublicProfile; relationship: Relationship } | null>(null);
  const [muted, setMuted] = useState(false);
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reporting, setReporting] = useState(false);

  const load = async () => {
    try {
      const [res, mutes] = await Promise.all([api.lookupHandle(handle), api.mutes()]);
      setData(res);
      setMuted(mutes.muted.includes(res.profile.id));
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 404) setMissing(true);
      else setError(describeError(e));
    }
  };
  useEffect(() => {
    void load();
    // Reload when the friends list changes (e.g. they accepted your request).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, friends]);

  if (missing) {
    return (
      <Modal title="Player" onClose={onClose}>
        <p>This player isn't available.</p>
        <button className="btn primary" onClick={onClose}>
          OK
        </button>
      </Modal>
    );
  }
  if (!data) {
    return (
      <Modal title="Player" onClose={onClose}>
        <p>{error || "Loading…"}</p>
      </Modal>
    );
  }

  const { profile, relationship } = data;
  const act = (fn: () => Promise<unknown>, done?: string) => async () => {
    setError("");
    try {
      await fn();
      if (done) setNotice(done);
      await Promise.all([load(), store.refreshFriends()]);
    } catch (e) {
      setError(describeError(e));
    }
  };
  const presence = store.presenceOf(profile.id);
  const incoming = friends?.incoming.find((r) => r.profile.id === profile.id);

  if (reporting) {
    return (
      <ReportDialog
        name={profile.displayName}
        onClose={() => setReporting(false)}
        onSubmit={(reason, note) =>
          reportSay
            ? reportSay(reason, note)
            : api.report({ kind: "profile", targetUserId: profile.id, reason, note })
        }
      />
    );
  }

  return (
    <Modal title={profile.displayName} onClose={onClose}>
      <div className="profile">
        <div className="stage">
          <Avatar profile={profile} scale={4} />
        </div>
        <div>
          <p>
            <span className="badge">@{profile.handle}</span>
          </p>
          {profile.pronouns && <p className="hint">{profile.pronouns}</p>}
          {profile.bio && <p>{profile.bio}</p>}
          {relationship === "friends" && (
            <p className="hint">
              <PresenceDot presence={presence} /> {presenceLabel(presence)}
            </p>
          )}
        </div>
      </div>
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      <p className="error" role="alert">
        {error}
      </p>
      {relationship === "self" ? (
        <p className="hint">That's you!</p>
      ) : confirmBlock ? (
        <div>
          <p>
            Block {profile.displayName}? You'll stop being friends, you won't see each other in the world, and
            they can't message you. They won't be told.
          </p>
          <div className="actions">
            <button className="btn" onClick={() => setConfirmBlock(false)}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={act(async () => {
                await api.block(profile.id);
                onClose();
              })}
            >
              Block
            </button>
          </div>
        </div>
      ) : (
        <ul className="menu">
          {relationship === "none" && (
            <li>
              <button
                className="menu-item btn-primary"
                onClick={act(() => api.requestFriend({ handle: profile.handle }), "Friend request sent.")}
              >
                Add friend
              </button>
            </li>
          )}
          {relationship === "outgoing" && <li className="hint">Friend request sent.</li>}
          {relationship === "incoming" && incoming && (
            <li>
              <button
                className="menu-item btn-primary"
                onClick={act(() => api.acceptRequest(incoming.id), "You're friends now!")}
              >
                Accept friend request
              </button>
            </li>
          )}
          {relationship === "friends" && (
            <li>
              <button
                className="menu-item btn-primary"
                onClick={act(async () => {
                  const c = await api.openDm(profile.id);
                  await store.refreshConversations();
                  onOpenChat(c.id);
                })}
              >
                Message
              </button>
            </li>
          )}
          <li>
            <button
              className="menu-item"
              onClick={act(
                () => (muted ? api.unmute(profile.id) : api.mute(profile.id)),
                muted ? "Unmuted." : "Muted. You won't see their messages in the world or in groups.",
              )}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
          </li>
          {relationship === "friends" && (
            <li>
              <button
                className="menu-item"
                onClick={act(() => api.unfriend(profile.id), "Removed from friends.")}
              >
                Remove friend
              </button>
            </li>
          )}
          <li>
            <button className="menu-item" onClick={() => setConfirmBlock(true)}>
              Block
            </button>
          </li>
          <li>
            <button className="menu-item" onClick={() => setReporting(true)}>
              Report
            </button>
          </li>
        </ul>
      )}
    </Modal>
  );
}

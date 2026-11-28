/**
 * Batch 17 (2026-11-28): announcements banner.
 *
 * Shows the first unexpired, unseen message from Umar's announcements
 * feed as a small dismissible banner at the top of every signed-in page.
 * Dismissing records the id as seen and moves on to the next new message
 * (if any). Tauri only — in the web app this renders nothing and fetches
 * nothing. Offline or a bad feed: renders nothing, silently.
 */
import { useEffect, useState } from "react";
import { isTauri } from "../lib/db";
import {
  Announcement,
  pickAnnouncement,
  todayStringLocal,
} from "../lib/announcements";
import {
  loadAnnouncements,
  markAnnouncementSeen,
  readSeenIds,
} from "../lib/announcementsClient";

export default function AnnouncementsBanner() {
  const [messages, setMessages] = useState<Announcement[]>([]);
  const [current, setCurrent] = useState<Announcement | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!isTauri()) return;
    loadAnnouncements()
      .then((list) => {
        if (cancelled) return;
        setMessages(list);
        setCurrent(pickAnnouncement(list, readSeenIds(), todayStringLocal()));
      })
      .catch(() => {
        /* silent no-op — the app works exactly as before */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!current) return null;

  const dismiss = () => {
    markAnnouncementSeen(current.id);
    const rest = messages.filter((m) => m.id !== current.id);
    setMessages(rest);
    setCurrent(pickAnnouncement(rest, readSeenIds(), todayStringLocal()));
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        margin: "0.75rem 0.75rem 0",
        padding: "0.6rem 0.9rem",
        background: "#eff6ff",
        border: "1px solid #bfdbfe",
        borderRadius: 8,
        fontSize: "0.875rem",
        color: "#1e3a5f",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: "1rem", lineHeight: 1.2 }}>
        {"\u{1F4E3}"}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>{current.title}</div>
        <div style={{ marginTop: 2 }}>{current.text}</div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        style={{
          border: "none",
          background: "transparent",
          cursor: "pointer",
          fontSize: "1rem",
          lineHeight: 1,
          color: "#64748b",
          padding: "0.1rem 0.25rem",
        }}
      >
        {"\u00D7"}
      </button>
    </div>
  );
}

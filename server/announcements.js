/**
 * Batch 17 (2026-11-28): announcements feed — server side.
 *
 * GET /api/announcements (public, no auth) reads announcements.json from
 * the updates directory — the same directory that already holds
 * android.json (mounted at /app/updates in the API container, i.e.
 * /opt/apps/app9/updates/ on the VPS host). Umar edits that one file;
 * no rebuild and no restart: the file is read on every request.
 *
 * Missing file, unreadable file, malformed JSON, or a wrong shape all
 * yield { messages: [] } — never an error. The Windows app treats an
 * empty feed as "no news" and carries on silently.
 */
import fs from 'fs';
import path from 'path';

function cleanMessage(raw) {
  if (typeof raw !== 'object' || raw === null) return null;
  if (typeof raw.id !== 'string' || raw.id.trim() === '') return null;
  if (typeof raw.title !== 'string' || raw.title.trim() === '') return null;
  if (typeof raw.text !== 'string' || raw.text.trim() === '') return null;
  let expires = null;
  if (raw.expires !== undefined && raw.expires !== null) {
    if (typeof raw.expires !== 'string') return null;
    expires = raw.expires;
  }
  return { id: raw.id.trim(), title: raw.title.trim(), text: raw.text.trim(), expires };
}

export function loadAnnouncements(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, 'announcements.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed && Array.isArray(parsed.messages) ? parsed.messages : null);
    if (!list) return { messages: [] };
    const messages = [];
    const seen = new Set();
    for (const item of list) {
      const m = cleanMessage(item);
      if (!m || seen.has(m.id)) continue;
      seen.add(m.id);
      messages.push(m);
    }
    return { messages };
  } catch {
    return { messages: [] };
  }
}

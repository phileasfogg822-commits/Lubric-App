import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import bcrypt from "bcryptjs";
import { dbExecute, dbSelect, isTauri } from "../../lib/db";
import { getDefaultPermissions, serializePermissions } from "../../lib/permissions";

/**
 * First-run setup — Windows standalone (Tauri) only.
 *
 * A fresh install has an EMPTY users table: ensureLocalSchema seeds the shop,
 * accounts and drum, but deliberately no users (there must be no default
 * credentials to ship). The very first launch therefore has no one who can
 * sign in, and this screen creates the owner instead.
 *
 * The owner is created with a bcrypt hash (never plaintext), the shop is
 * renamed to the buyer's business name, and the same name is stored as the
 * app_name branding key so it shows beside lubric.app. After setup the
 * owner signs in on /login like any other member.
 *
 * This screen only ever runs when the users table is empty. If an owner
 * already exists — a second visit, or a non-Tauri build — it sends the
 * visitor back to /login instead of creating a second owner.
 */
export default function FirstRunSetup() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isTauri()) {
        navigate("/login", { replace: true });
        return;
      }
      try {
        const rows = await dbSelect<{ c: number }>("SELECT COUNT(*) AS c FROM users");
        if (!cancelled && rows[0] && Number(rows[0].c) > 0) {
          navigate("/login", { replace: true });
          return;
        }
      } catch {
        // Schema not ready yet — stay on this screen; the submit retries.
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const name = fullName.trim();
    const mail = email.trim().toLowerCase();
    const business = businessName.trim();
    if (!name || !mail || !business) {
      setError("Your name, email and business name are all required.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
      setError("That email does not look right.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      const hash = await bcrypt.hash(password, 10);
      await dbExecute(
        "INSERT INTO users (full_name, email, password_hash, role, permissions) VALUES ($1, $2, $3, 'owner', $4)",
        [name, mail, hash, serializePermissions(getDefaultPermissions("owner"))]
      );
      await dbExecute("UPDATE shops SET name = $1 WHERE id = 1", [business]);
      await dbExecute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('app_name', $1)",
        [business]
      );
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the owner account.");
    } finally {
      setSaving(false);
    }
  }

  if (!ready) {
    return <div style={{ padding: 32, textAlign: "center" }}>Loading...</div>;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0f172a 0%, #1e40af 100%)",
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 12,
          padding: "2.5rem",
          width: 400,
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a" }}>lubric.app</div>
          <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: 4 }}>
            Set up your shop — this takes a minute, once
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className="alert alert-error">{error}</div>}

          <div className="form-group">
            <label className="label">Business name</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. My Shop"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="label">Your full name (owner)</label>
            <input
              type="text"
              className="input"
              placeholder="e.g. Mudassar Naeem"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              placeholder="owner@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="label">Password (at least 8 characters)</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="label">Confirm password</label>
            <input
              type="password"
              className="input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          <button type="submit" className="btn btn-primary btn-full btn-lg" disabled={saving}>
            {saving ? "Creating..." : "Create owner & start"}
          </button>
        </form>

        <div style={{ marginTop: 20, fontSize: "0.75rem", color: "#94a3b8", textAlign: "center" }}>
          After this you sign in with the email and password above. You can add
          manager, accountant, worker and cashier accounts later under Team &amp; Access.
        </div>
      </div>
    </div>
  );
}

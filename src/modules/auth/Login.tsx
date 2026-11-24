import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { dbSelect, isTauri } from "../../lib/db";
import { getRememberedEmails } from "../../lib/loginMemory";

/**
 * Sign-in.
 *
 * Passwords are NEVER saved: the form carries autoComplete="off" with
 * autoComplete="new-password" on the password field, the password state
 * starts empty on every arrival (and logout unmounts this screen), and no
 * password value is ever written to storage — see src/lib/loginMemory.ts.
 * What IS remembered is the email, so the screen offers it back as a
 * clickable user box (Windows XP style): pick your box, type your
 * password, sign in.
 *
 * Where the boxes come from:
 *  - Windows standalone (Tauri): the LOCAL users table — real users,
 *    readable locally, no server involved.
 *  - VPS / web: ONLY the emails previously signed in on THIS device
 *    (localStorage, no passwords ever). There is deliberately no
 *    user-listing endpoint — that would leak the user directory.
 */
export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<{ email: string; name: string }[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      if (isTauri()) {
        try {
          const rows = await dbSelect<{ email: string; full_name: string }>(
            "SELECT email, full_name FROM users ORDER BY full_name"
          );
          setUsers(rows.map((r) => ({ email: r.email, name: r.full_name || r.email })));
        } catch {
          setUsers([]);
        }
      } else {
        setUsers(getRememberedEmails().map((e) => ({ email: e, name: e })));
      }
    })();
  }, []);

  function pickUser(u: { email: string; name: string }) {
    setEmail(u.email);
    setPicked(u.email);
    setPassword("");
    setError("");
    passwordRef.current?.focus();
  }

  function useDifferentEmail() {
    setPicked(null);
    setEmail("");
    setPassword("");
    setError("");
    emailRef.current?.focus();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter email and password");
      return;
    }
    setLoading(true);
    setError("");
    const success = await login(email, password);
    setLoading(false);
    if (success) {
      navigate("/dashboard");
    } else {
      setError("Invalid email or password");
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "linear-gradient(135deg, #0f172a 0%, #1e40af 100%)",
    }}>
      <div style={{
        background: "white",
        borderRadius: 12,
        padding: "2.5rem",
        width: 360,
        boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0f172a" }}>LUBRIC POS</div>
          <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: 4 }}>lubric.app</div>
        </div>

        {users.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8, textAlign: "center" }}>
              Who is signing in?
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
              {users.map((u) => {
                const active = picked === u.email;
                const initial = (u.name.trim()[0] ?? "?").toUpperCase();
                return (
                  <button
                    key={u.email}
                    type="button"
                    onClick={() => pickUser(u)}
                    title={u.email}
                    style={{
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                      width: 84, padding: "10px 4px 8px", cursor: "pointer",
                      background: active ? "#eff6ff" : "white",
                      border: `2px solid ${active ? "#2563eb" : "#e2e8f0"}`,
                      borderRadius: 10,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 40, height: 40, borderRadius: "50%",
                        background: active ? "#2563eb" : "#64748b",
                        color: "white", display: "flex", alignItems: "center",
                        justifyContent: "center", fontSize: "1.1rem", fontWeight: 700,
                      }}
                    >
                      {initial}
                    </span>
                    <span style={{ fontSize: "0.68rem", fontWeight: 600, color: "#334155", wordBreak: "break-all", textAlign: "center", lineHeight: 1.25 }}>
                      {u.name}
                    </span>
                  </button>
                );
              })}
            </div>
            {picked && (
              <div style={{ textAlign: "center", marginTop: 8 }}>
                <button
                  type="button"
                  onClick={useDifferentEmail}
                  style={{ background: "none", border: "none", color: "#2563eb", fontSize: "0.75rem", cursor: "pointer", textDecoration: "underline" }}
                >
                  Use a different email
                </button>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} autoComplete="off">
          {error && <div className="alert alert-error">{error}</div>}

          <div className="form-group">
            <label className="label">Email</label>
            <input
              ref={emailRef}
              type="email"
              className="input"
              placeholder="admin@lubric.app"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setPicked(null); }}
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="label">Password</label>
            <input
              ref={passwordRef}
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-full btn-lg"
            disabled={loading}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

      </div>
    </div>
  );
}

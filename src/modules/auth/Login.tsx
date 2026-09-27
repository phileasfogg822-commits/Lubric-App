import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
          <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: 4 }}>Zafar Lubricants</div>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className="alert alert-error">{error}</div>}

          <div className="form-group">
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              placeholder="admin@lubric.app"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="label">Password</label>
            <input
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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

        <div style={{ marginTop: 20, fontSize: "0.75rem", color: "#94a3b8", textAlign: "center" }}>
          <div>Admin: admin@lubric.app / admin123</div>
          <div>Cashier: cashier@lubric.app / cashier123</div>
        </div>
      </div>
    </div>
  );
}

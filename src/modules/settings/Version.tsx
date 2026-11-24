import { Page } from "../../components/Page";
import {
  APP_VERSION,
  GIT_SHA,
  GIT_SHA_SHORT,
  GIT_SUBJECT,
  BUILD_DATE,
  formatBuildDateTime,
} from "../../lib/version";

/**
 * Version (About) page — which build is installed.
 *
 * Reachable from the sidebar by every signed-in user (no permission gate:
 * a cashier reporting a bug needs to read this too). The login screen
 * shows the short line; this page shows every baked field, so the installed
 * build can be matched against the latest installer by its commit SHA.
 */
export default function Version() {
  const rows: { label: string; value: string; mono?: boolean }[] = [
    { label: "Version", value: `v${APP_VERSION}` },
    { label: "Build", value: GIT_SHA_SHORT, mono: true },
    { label: "Full commit", value: GIT_SHA, mono: true },
    { label: "Built", value: formatBuildDateTime(BUILD_DATE) },
    { label: "Commit", value: GIT_SUBJECT },
  ];
  return (
    <Page title="Version" subtitle="Which build of lubric.app is installed">
      <div style={{ maxWidth: 640 }}>
        {rows.map((r) => (
          <div
            key={r.label}
            style={{
              display: "flex",
              gap: 16,
              padding: "10px 0",
              borderBottom: "1px solid #e2e8f0",
            }}
          >
            <div style={{ width: 110, flexShrink: 0, fontWeight: 600, color: "#475569" }}>
              {r.label}
            </div>
            <div
              style={{
                color: "#0f172a",
                fontFamily: r.mono ? "monospace" : undefined,
                wordBreak: "break-all",
              }}
            >
              {r.value}
            </div>
          </div>
        ))}
        <div style={{ marginTop: 16, fontSize: "0.85rem", color: "#64748b" }}>
          If this build is older than the latest installer, install the new
          one over it — your data and accounts stay.
        </div>
      </div>
    </Page>
  );
}

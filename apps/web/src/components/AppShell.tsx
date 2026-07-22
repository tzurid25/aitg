"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import type { ReactNode } from "react";

interface NavItem {
  href: string;
  label: string;
}

/**
 * Navigation is grouped by what the user is doing, not by database table.
 * "Runs" comes first because checking a result is the daily action; setup
 * lives further down because it's done once.
 */
const NAV_GROUPS: Array<{ heading: string; items: NavItem[] }> = [
  {
    heading: "Monitor",
    items: [
      { href: "/app", label: "Overview" },
      { href: "/app/runs", label: "Runs" },
      { href: "/app/repositories", label: "Repositories" },
    ],
  },
  {
    heading: "Configure",
    items: [
      { href: "/app/projects", label: "Projects" },
      { href: "/app/gates", label: "Quality gates" },
      { href: "/app/keys", label: "API keys" },
      { href: "/app/integrations", label: "Integrations" },
    ],
  },
  {
    heading: "Organization",
    items: [
      { href: "/app/team", label: "Team" },
      { href: "/app/billing", label: "Billing" },
      { href: "/app/settings", label: "Settings" },
    ],
  },
];

export function AppShell({
  children,
  organizationName,
  userEmail,
  quota,
}: {
  children: ReactNode;
  organizationName: string;
  userEmail: string;
  quota: { used: number; limit: number };
}) {
  const pathname = usePathname();
  const pct = quota.limit > 0 ? Math.min(100, (quota.used / quota.limit) * 100) : 0;
  const nearLimit = pct >= 80;

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: "var(--sidebar-width)",
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          background: "var(--surface)",
          display: "flex",
          flexDirection: "column",
          position: "sticky",
          top: 0,
          height: "100vh",
        }}
      >
        <div style={{ padding: "18px 18px 14px" }}>
          <Link href="/app" style={{ display: "block" }}>
            <div
              className="mono"
              style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}
            >
              aitg
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-faint)",
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {organizationName}
            </div>
          </Link>
        </div>

        <nav style={{ flex: 1, overflowY: "auto", padding: "0 10px" }}>
          {NAV_GROUPS.map((group) => (
            <div key={group.heading} style={{ marginBottom: 18 }}>
              <div className="label" style={{ padding: "0 8px", marginBottom: 6 }}>
                {group.heading}
              </div>
              {group.items.map((item) => {
                const active =
                  item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    style={{
                      display: "block",
                      padding: "7px 8px",
                      fontSize: 13.5,
                      borderRadius: "var(--radius-sm)",
                      color: active ? "var(--text)" : "var(--text-muted)",
                      background: active ? "var(--surface-raised)" : "transparent",
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11.5,
              marginBottom: 6,
            }}
          >
            <span className="label">Mutants used</span>
            <span
              className="mono"
              style={{ color: nearLimit ? "var(--warn)" : "var(--text-muted)", fontSize: 11.5 }}
            >
              {quota.used.toLocaleString()}/{quota.limit.toLocaleString()}
            </span>
          </div>
          <div
            style={{
              height: 3,
              background: "var(--border)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: nearLimit ? "var(--warn)" : "var(--accent)",
              }}
            />
          </div>

          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid var(--border)",
              fontSize: 12,
              color: "var(--text-faint)",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {userEmail}
          </div>
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: "/" })}
            style={{
              marginTop: 6,
              padding: 0,
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              fontSize: 12,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0 }}>
        <div style={{ padding: "28px 32px", maxWidth: 1200 }}>{children}</div>
        <footer
          style={{
            padding: "20px 32px",
            borderTop: "1px solid var(--border)",
            fontSize: 11.5,
            color: "var(--text-faint)",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>AI Test Integrity Guard v1.0</span>
          <a href="https://tacticode.co.il" target="_blank" rel="noreferrer">
            Powered by TactiCode
          </a>
        </footer>
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: 24,
        gap: 16,
      }}
    >
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
          {title}
        </h1>
        {description && (
          <p style={{ color: "var(--text-muted)", fontSize: 13.5, margin: "5px 0 0" }}>
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

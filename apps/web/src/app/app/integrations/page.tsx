import { prisma } from "@aitg/database";
import { Card, SectionLabel, Table, Th, Td, EmptyState } from "@aitg/ui";
import { requireSession, scoped } from "../../../lib/session";
import { PageHeader } from "../../../components/AppShell";
import { relativeTime } from "../../../lib/format";
import { ConnectRepos } from "../../../components/ConnectRepos";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const session = await requireSession();

  const installations = await prisma.githubInstallation.findMany({
    where: scoped(session, { uninstalledAt: null }),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      installationId: true,
      accountLogin: true,
      accountType: true,
      suspendedAt: true,
      createdAt: true,
    },
  });

  const appSlug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect GitHub to get mutation scores as a check on every pull request."
      />

      {installations.length === 0 ? (
        <EmptyState
          title="GitHub not connected"
          description="Install the AITG GitHub App to post mutation results directly onto pull requests. Your source code stays on your CI runner — only the report is uploaded."
          action={
            appSlug ? (
              <a
                href={`https://github.com/apps/${appSlug}/installations/new`}
                style={{
                  display: "inline-block",
                  padding: "10px 18px",
                  fontSize: 14,
                  fontWeight: 500,
                  background: "var(--accent)",
                  color: "#06251F",
                  borderRadius: "var(--radius-md)",
                }}
              >
                Install GitHub App
              </a>
            ) : (
              // Without a registered App there is nothing to link to, so say
              // what is missing and where to fix it rather than rendering a
              // button that does nothing.
              <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7, textAlign: "left", maxWidth: 460 }}>
                <strong style={{ color: "var(--text)" }}>
                  This server has no GitHub App registered yet.
                </strong>
                <br />
                Register one at{" "}
                <a
                  href="https://github.com/settings/apps/new"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--accent)", textDecoration: "underline" }}
                >
                  github.com/settings/apps/new
                </a>
                , then set these in <span className="mono">.env</span> and restart:
                <pre
                  className="mono"
                  style={{
                    marginTop: 10,
                    padding: 12,
                    fontSize: 11.5,
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    overflow: "auto",
                  }}
                >{`GITHUB_APP_ID=""
GITHUB_APP_PRIVATE_KEY=""
GITHUB_WEBHOOK_SECRET=""
NEXT_PUBLIC_GITHUB_APP_SLUG=""`}</pre>
                Full walkthrough in <span className="mono">SETUP-GITHUB-APP.md</span>.
              </div>
            )
          }
        />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th>Type</Th>
                <Th>Installation</Th>
                <Th>Status</Th>
                <Th align="right">Connected</Th>
              </tr>
            </thead>
            <tbody>
              {installations.map((install) => (
                <tr key={install.id}>
                  <Td mono>{install.accountLogin}</Td>
                  <Td>{install.accountType}</Td>
                  <Td mono>{install.installationId}</Td>
                  <Td>
                    <span style={{ color: install.suspendedAt ? "var(--warn)" : "var(--killed)" }}>
                      {install.suspendedAt ? "Suspended" : "Active"}
                    </span>
                  </Td>
                  <Td align="right" mono>{relativeTime(install.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <div style={{ marginTop: 20 }}>
        <ConnectRepos hasInstallation={installations.length > 0} />
      </div>

      <div style={{ marginTop: 20 }}>
        <Card>
          <SectionLabel>Add the workflow manually</SectionLabel>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px", lineHeight: 1.7 }}>
            Installing the App lets AITG write checks and comments. Running the scan is
            still your CI&apos;s job — that is what keeps your source code on your own
            runner. Commit this to <span className="mono">.github/workflows/aitg.yml</span>:
          </p>
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: 14,
              fontSize: 12,
              lineHeight: 1.7,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              overflow: "auto",
            }}
          >{`name: Mutation quality gate
on:
  pull_request:
    types: [opened, reopened, synchronize]

jobs:
  mutation-score:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0     # needed to find the merge base
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm install -g @aitg/cli
      - run: aitg scan --base "origin/\${{ github.event.pull_request.base.ref }}"
        env:
          AITG_API_KEY: \${{ secrets.AITG_API_KEY }}
          AITG_PR_NUMBER: \${{ github.event.pull_request.number }}`}</pre>
          <p style={{ fontSize: 12.5, color: "var(--text-faint)", margin: "12px 0 0" }}>
            Add <span className="mono">AITG_API_KEY</span> under Settings → Secrets →
            Actions in your repository. Generate one from the API keys page.
          </p>
        </Card>
      </div>
    </>
  );
}

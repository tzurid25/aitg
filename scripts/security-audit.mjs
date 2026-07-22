#!/usr/bin/env node
/**
 * Authorization audit.
 *
 * Enumerates every route handler and flags any that reads a caller-supplied
 * identifier without either a tenant-scoped lookup or an explicit
 * verification marker.
 *
 * This exists because of a real bug: /api/github/callback bound an
 * attacker-controlled installation_id to the caller's organization with no
 * verification, which allowed repository takeover. That bug is exactly this
 * shape, and this check would have caught it.
 *
 * It is deliberately crude — grep, not analysis. A precise checker would be
 * a research project; a crude one that runs on every merge catches the class
 * of mistake that actually happens.
 */

import fs from "node:fs";
import path from "node:path";

const ROOTS = ["apps/api/src/app/api", "apps/web/src/app/api"];

/** Sources an attacker controls. */
const CALLER_SUPPLIED = [
  /\bbody\.[a-zA-Z]+/,
  /searchParams\.get\(/,
  /\bparams\.[a-zA-Z]+/,
  /req(uest)?\.headers\.get\(/,
];

/** Evidence that the value was constrained before use. */
const AUTHORIZATION_EVIDENCE = [
  /scopedWhere\(/,
  /scoped\(session/,
  /organizationId:\s*(auth|session)\./,
  // Explicit opt-out, which must be justified in a comment on the same line.
  /SECURITY-REVIEWED:/,
];

/** Endpoints that are authenticationless by design. */
const PUBLIC_BY_DESIGN = new Set([
  "apps/api/src/app/api/health/route.ts",
  "apps/api/src/app/api/cli/auth/device/route.ts",
  "apps/web/src/app/api/auth/[...nextauth]/route.ts",
]);

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

const findings = [];
let checked = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    checked++;
    if (PUBLIC_BY_DESIGN.has(file)) continue;

    const source = fs.readFileSync(file, "utf8");

    const readsUntrusted = CALLER_SUPPLIED.some((re) => re.test(source));
    if (!readsUntrusted) continue;

    // An explicit SECURITY-REVIEWED marker clears both checks. Some endpoints
    // are unauthenticated by design — a device-code poll has no session yet,
    // because obtaining one is the point. The marker forces that reasoning to
    // be written down next to the code rather than lost in review.
    const reviewed = /SECURITY-REVIEWED:/.test(source);

    const authenticated =
      /authenticateRequest\(|getSessionContext\(|requireSession\(|verifyWebhookSignature\(/.test(
        source,
      );

    const constrained =
      reviewed || AUTHORIZATION_EVIDENCE.some((re) => re.test(source));


    // An explicit SECURITY-REVIEWED marker clears both checks. Some endpoints
    // are unauthenticated by design — a device-code poll has no session yet,
    // because obtaining one is the point. The marker forces that reasoning to
    // be written down next to the code rather than lost in review.
    if (!authenticated && !reviewed) {
      findings.push({
        file,
        severity: "HIGH",
        issue:
          "Reads a caller-supplied identifier with no authentication check " +
          "and no SECURITY-REVIEWED justification.",
      });
      continue;
    }

    if (!constrained) {
      findings.push({
        file,
        severity: "REVIEW",
        issue:
          "Reads a caller-supplied identifier but shows no tenant-scoped lookup. " +
          "Confirm entitlement is verified another way, then mark the line " +
          "SECURITY-REVIEWED: <reason>.",
      });
    }
  }
}

console.log(`\nAuthorization audit — ${checked} route handlers\n`);

if (findings.length === 0) {
  console.log("  No unconstrained caller-supplied identifiers found.\n");
  process.exit(0);
}

for (const finding of findings) {
  console.log(`  [${finding.severity}] ${finding.file}`);
  console.log(`      ${finding.issue}\n`);
}

const high = findings.filter((f) => f.severity === "HIGH").length;
console.log(
  `  ${findings.length} finding${findings.length === 1 ? "" : "s"} ` +
    `(${high} high). See SECURITY.md, Rule 1.\n`,
);

// Only HIGH fails the build. REVIEW is a prompt for a human, and blocking on
// it would train people to add the marker without thinking.
process.exit(high > 0 ? 1 : 0);

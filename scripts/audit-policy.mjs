#!/usr/bin/env node
/**
 * Risk-classified npm audit gate.
 *
 * Production dependencies are held to the strictest bar because they ship in
 * the runtime images. Development-only advisories are still reported, but only
 * a critical one blocks the build, and only until its documented expiry.
 *
 * Every exception must live in security/audit-allowlist.json with a reason and
 * an expiry date. An expired entry fails the build instead of silently
 * extending itself, so accepted risk is reviewed on a schedule.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const allowlistPath = resolve(root, 'security/audit-allowlist.json');
const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

function runAudit(omitDev) {
  const args = ['audit', '--json'];
  if (omitDev) args.push('--omit=dev');
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  const stdout = result.stdout?.trim();
  if (!stdout) {
    throw new Error(`npm audit produced no output (exit ${result.status}): ${result.stderr ?? ''}`);
  }
  try {
    const report = JSON.parse(stdout);
    if (report.error || !report.metadata) {
      throw new Error(`npm audit did not return a usable report: ${JSON.stringify(report.error)}`);
    }
    return report;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Could not parse npm audit output: ${stdout.slice(0, 400)}`);
    }
    throw error;
  }
}

function advisoriesOf(vulnerability) {
  const ids = new Set();
  for (const via of vulnerability.via ?? []) {
    if (typeof via === 'object' && via.url) {
      const match = /GHSA-[a-z0-9-]+/i.exec(via.url);
      if (match) ids.add(match[0]);
    }
  }
  // Pure dependency-chain entries carry no advisory of their own; the
  // advisories appear on the package that introduces them.
  return [...ids];
}

function loadAllowlist(today) {
  const entries = JSON.parse(readFileSync(allowlistPath, 'utf8')).entries ?? [];
  const active = [];
  const expired = [];
  for (const entry of entries) {
    if (!entry.id || !entry.reason || !entry.expires || !entry.scope) {
      throw new Error(`Invalid allowlist entry: ${JSON.stringify(entry)}`);
    }
    if (new Date(`${entry.expires}T23:59:59Z`) < today) expired.push(entry);
    else active.push(entry);
  }
  return { active, expired };
}

function findAllowlistEntry(entry, scope, active) {
  return active.find(
    (allowed) =>
      allowed.id === entry.id &&
      allowed.scope === scope &&
      (!allowed.package || allowed.package === entry.package),
  );
}

function collect(report, scope, active) {
  const findings = [];
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    for (const id of advisoriesOf(vulnerability)) {
      const entry = { id, package: name, severity: vulnerability.severity };
      findings.push({ ...entry, allowlisted: Boolean(findAllowlistEntry(entry, scope, active)) });
    }
  }
  return findings;
}

function describe(findings) {
  return findings
    .map(
      (finding) =>
        `  - ${finding.severity.toUpperCase()} ${finding.package} ${finding.id}` +
        (finding.allowlisted ? ' (allowlisted)' : ''),
    )
    .join('\n');
}

function countBySeverity(report) {
  const counts = report.metadata?.vulnerabilities ?? {};
  return (
    `critical ${counts.critical ?? 0}, high ${counts.high ?? 0}, ` +
    `moderate ${counts.moderate ?? 0}, low ${counts.low ?? 0}`
  );
}

function main() {
  const today = new Date();
  const { active, expired } = loadAllowlist(today);
  const prod = runAudit(true);
  const full = runAudit(false);

  const prodFindings = collect(prod, 'production', active);
  const prodIds = new Set(prodFindings.map((finding) => finding.id));
  const devFindings = collect(full, 'development', active).filter(
    (finding) => !prodIds.has(finding.id),
  );

  const blocking = [
    ...prodFindings.filter(
      (finding) => severityRank[finding.severity] >= severityRank.high && !finding.allowlisted,
    ),
    ...devFindings.filter((finding) => finding.severity === 'critical' && !finding.allowlisted),
  ];
  const warnings = [
    ...prodFindings.filter(
      (finding) => severityRank[finding.severity] < severityRank.high && !finding.allowlisted,
    ),
    ...devFindings.filter(
      (finding) => severityRank[finding.severity] < severityRank.critical && !finding.allowlisted,
    ),
  ];

  console.log(`Production dependencies: ${countBySeverity(prod)}`);
  console.log(`Full tree (production + development): ${countBySeverity(full)}`);
  if (prodFindings.length) console.log(`\nProduction findings:\n${describe(prodFindings)}`);
  if (devFindings.length) console.log(`\nDevelopment-only findings:\n${describe(devFindings)}`);

  if (expired.length) {
    console.error('\nExpired audit allowlist entries (remove or re-review them):');
    for (const entry of expired) {
      console.error(`  - ${entry.id} ${entry.package ?? ''} expired ${entry.expires}`);
    }
  }

  if (blocking.length) {
    console.error('\nAudit policy failed. Blocking findings:');
    console.error(describe(blocking));
  }
  if (warnings.length) {
    console.warn('\nNon-blocking findings (review when convenient):');
    console.warn(describe(warnings));
  }

  if (blocking.length || expired.length) {
    console.error(
      '\nFix the dependency, or add a time-boxed entry to security/audit-allowlist.json ' +
        'with a reason and expiry date.',
    );
    process.exit(1);
  }
  console.log('\nAudit policy passed.');
}

main();

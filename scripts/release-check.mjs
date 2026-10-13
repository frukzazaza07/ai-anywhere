import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readReleaseFile, validateReleaseFile } from './release-files.mjs';

// Examine Git's release candidates only; never open ignored credentials or runtime state.
const fileList = process.argv.includes('--stdin') ? readFileSync(0, 'utf8')
  : execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8', maxBuffer: 2_000_000 });
const files = fileList.split(process.argv.includes('--stdin') ? /\r?\n/ : '\0').filter(Boolean);
const findings = [];
const root = process.cwd();
const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['service token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,}|AIza[A-Za-z0-9_-]{35})\b/],
  ['Discord token', /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/],
  ['personal home path', /(?:[A-Z]:[\\/]Users[\\/](?!Public\b|Default\b|<)[^\s'"<>\\/]+|\/(?:Users|home)\/(?!<)[^\s'"<>/]+)/i],
  ['credential assignment', /(?:DISCORD_TOKEN|GEMINI_API_KEY|GOOGLE_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)\s*=\s*['"]?(?!replace_with_|\s|['"]?\s*$)[A-Za-z0-9_-]{20,}/m],
];
for (const file of files) {
  try {
    // Validate even candidates with extensions whose content is not scanned.
    validateReleaseFile(root, file);
    if (!/\.(?:[cm]?[jt]s|json|md|ya?ml)$/.test(file) && !['LICENSE', '.env.example', '.gitignore'].includes(file)) continue;
    const content = readReleaseFile(root, file);
    for (const [kind, pattern] of patterns) {
      if (pattern.test(content)) findings.push({ file, kind });
    }
  } catch (error) {
    const kind = error instanceof Error && !('code' in error) ? error.message : 'unable to safely read release candidate';
    findings.push({ file, kind });
  }
}
// Mandatory metadata uses the same checks as ordinary candidates.
let lockText;
let packageText;
try {
  lockText = readReleaseFile(root, 'package-lock.json');
  packageText = readReleaseFile(root, 'package.json');
} catch {
  console.error('FAIL: unable to safely read package metadata');
  process.exit(1);
}
const lock = JSON.parse(lockText);
const pkg = JSON.parse(packageText);
if (pkg.version !== lock.version || pkg.version !== lock.packages[''].version
  || pkg.license !== lock.packages[''].license) findings.push({ file: 'package-lock.json', kind: 'package metadata mismatch' });
const licenses = {};
const missing = [];
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path) continue;
  if (!entry.license) missing.push(path);
  const license = entry.license ?? 'UNKNOWN';
  licenses[license] = (licenses[license] ?? 0) + 1;
}
console.log('Release candidates scanned: ' + files.length);
console.log('Lockfile SHA-256: ' + createHash('sha256').update(lockText).digest('hex'));
console.log('Declared dependency licenses: ' + JSON.stringify(licenses));
for (const path of missing) console.log('NOTICE: license metadata missing: ' + path);
for (const finding of findings) console.error('FAIL: ' + finding.file + ': ' + finding.kind);
console.log('Heuristic scan only; manually review history, artifacts, notices and current dependency advisories before publication.');
if (findings.length) process.exitCode = 1;

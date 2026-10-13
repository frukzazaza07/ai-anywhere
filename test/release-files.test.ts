import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { readReleaseFile, validateReleaseFile } = createRequire(import.meta.url)('../scripts/release-files.mjs') as {
  readReleaseFile: (root: string, file: string) => string;
  validateReleaseFile: (root: string, file: string) => { path: string; dev: number; ino: number };
};

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'release-file-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, 'repo');
  const outside = join(directory, 'outside');
  mkdirSync(root); mkdirSync(outside);
  writeFileSync(join(root, '.env'), 'synthetic private file');
  writeFileSync(join(root, '.env.example'), 'DISCORD_TOKEN=replace_with_bot_token');
  writeFileSync(join(outside, 'notes.md'), 'synthetic external file');
  return { directory, root, outside };
}

function assertNoOpen(t: TestContext, check: () => void) {
  const mocked = t.mock.method(fs, 'openSync', () => { throw new Error('file content must not be opened'); });
  syncBuiltinESMExports();
  try { check(); assert.equal(mocked.mock.callCount(), 0); }
  finally { mocked.mock.restore(); syncBuiltinESMExports(); }
}

test('release files allow ordinary files and the root placeholder template', t => {
  const f = fixture(t);
  mkdirSync(join(f.root, 'docs ไทย'));
  writeFileSync(join(f.root, 'docs ไทย', 'notes.md'), 'safe documentation');
  assert.equal(readReleaseFile(f.root, 'docs ไทย/notes.md'), 'safe documentation');
  assert.equal(readReleaseFile(f.root, '.env.example'), 'DISCORD_TOKEN=replace_with_bot_token');
});

test('release files reject private state, backups and ignored artifact directories before opening', t => {
  const f = fixture(t);
  assertNoOpen(t, () => {
    for (const file of ['.env', '.env~', '.env.local', 'docs/.env.example', 'ai.config.json',
      '.ai-config-overrides.json.tmp', '.ai-preferences.json~', '.codex-schedules.json.bak',
      '.verification/notes.md', 'node-24/package.json', 'node_modules/package.json', 'dist/bot.js', '.git/config', 'debug.log']) {
      assert.throws(() => readReleaseFile(f.root, file), /private runtime file tracked/);
    }
    if (process.platform === 'win32') {
      for (const file of ['.ENV', 'AI.CONFIG.JSON', '.VERIFICATION/notes.md', 'NODE_MODULES/package.json']) {
        assert.throws(() => readReleaseFile(f.root, file), /private runtime file tracked/);
      }
    }
  });
});

test('release files reject outside paths, traversal, alternate streams and malformed names before opening', t => {
  const f = fixture(t);
  assertNoOpen(t, () => {
    for (const file of [join(f.outside, 'notes.md'), '../outside/notes.md', 'docs/../.env', './.env',
      'C:/outside/notes.md', 'C:notes.md', '//host/share/notes.md', 'notes.md:private', 'docs//notes.md', '', 'bad\0.md']) {
      assert.throws(() => readReleaseFile(f.root, file), /invalid release candidate path/);
    }
    if (process.platform === 'win32') {
      for (const file of ['.env ', '.env.', 'docs /notes.md']) {
        assert.throws(() => readReleaseFile(f.root, file), /invalid release candidate path/);
      }
    }
  });
});

test('release files reject directory symlinks and Windows junctions targeting ignored or external folders before opening', t => {
  const f = fixture(t);
  const ignored = join(f.root, '.verification');
  mkdirSync(ignored); writeFileSync(join(ignored, 'notes.md'), 'synthetic ignored file');
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  symlinkSync(f.outside, join(f.root, 'external-docs'), type);
  symlinkSync(ignored, join(f.root, 'ignored-docs'), type);
  assertNoOpen(t, () => {
    for (const file of ['external-docs/notes.md', 'ignored-docs/notes.md']) {
      assert.throws(() => readReleaseFile(f.root, file), /symbolic link in release candidate path/);
    }
  });
});

test('release files reject leaf symlinks, including dangling links and package metadata aliases', t => {
  const f = fixture(t);
  try { symlinkSync(join(f.root, '.env'), join(f.root, 'notes.md'), 'file'); }
  catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip('File symlinks require Windows developer mode or symlink privileges');
      return;
    }
    throw error;
  }
  symlinkSync(join(f.outside, 'missing.md'), join(f.root, 'dangling.md'), 'file');
  symlinkSync(join(f.outside, 'notes.md'), join(f.root, 'package-lock.json'), 'file');
  assertNoOpen(t, () => {
    for (const file of ['notes.md', 'dangling.md', 'package-lock.json']) {
      assert.throws(() => readReleaseFile(f.root, file), /symbolic link in release candidate path/);
    }
  });
});

test('release files reject leaf symlink metadata before opening even when Windows file links are unavailable', t => {
  const f = fixture(t);
  const file = join(f.root, 'package.json');
  writeFileSync(file, 'synthetic metadata');
  const originalLstat = fs.lstatSync;
  const mocked = t.mock.method(fs, 'lstatSync', (path: fs.PathLike) => {
    const entry = originalLstat(path);
    if (path === file) entry.isSymbolicLink = () => true;
    return entry;
  });
  syncBuiltinESMExports();
  try {
    assertNoOpen(t, () => {
      assert.throws(() => readReleaseFile(f.root, 'package.json'), /symbolic link in release candidate path/);
    });
  } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
});

test('release files reject directory candidates and missing files without opening content', t => {
  const f = fixture(t);
  mkdirSync(join(f.root, 'directory.md'));
  assertNoOpen(t, () => {
    assert.throws(() => readReleaseFile(f.root, 'directory.md'), /not a regular file/);
    assert.throws(() => validateReleaseFile(f.root, 'missing.md'), { code: 'ENOENT' });
  });
});

test('release files detect replacement between validation and opening before reading the descriptor', t => {
  const f = fixture(t);
  const file = join(f.root, 'notes.md');
  writeFileSync(file, 'safe original');
  const replacement = join(f.root, 'replacement.md');
  writeFileSync(replacement, 'synthetic replacement');
  const originalOpen = fs.openSync;
  const mocked = t.mock.method(fs, 'openSync', (...args: Parameters<typeof fs.openSync>) => {
    if (args[0] === file) return originalOpen(replacement, args[1], args[2]);
    return originalOpen(...args);
  });
  syncBuiltinESMExports();
  try { assert.throws(() => readReleaseFile(f.root, 'notes.md'), /changed while opening/); }
  finally { mocked.mock.restore(); syncBuiltinESMExports(); }
});

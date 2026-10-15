import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep, win32 } from 'node:path';

const privateFile = /(^|\/)(?:\.env(?:[.~].*)?|ai\.config\.json(?:[.~].*)?|\.ai-config-overrides\.json(?:[.~].*)?|\.ai-preferences\.json(?:[.~].*)?|\.codex-schedules\.json(?:[.~].*)?|\.ai-jobs|\.git|\.verification|node_modules|node-24|dist)(?:\/|$)|(?:^|\/)[^/]*\.log$/;

function isPrivate(file) {
  const name = process.platform === 'win32' ? file.toLowerCase() : file;
  return name !== '.env.example' && privateFile.test(name);
}

/** Check every component without following candidate symlinks or directory junctions. */
export function validateReleaseFile(root, file) {
  if (typeof file !== 'string' || !file || /[\0\r\n:]/.test(file) || isAbsolute(file) || win32.isAbsolute(file)) {
    throw new Error('invalid release candidate path');
  }
  const parts = file.split(sep).join('/').split('/');
  if (parts.some(part => !part || part === '.' || part === '..'
    || (process.platform === 'win32' && /[. ]$/.test(part)))) throw new Error('invalid release candidate path');
  const name = parts.join('/');
  if (isPrivate(name)) throw new Error('private runtime file tracked');
  const canonicalRoot = realpathSync(root);
  let path = canonicalRoot;
  let entry;
  for (const [index, part] of parts.entries()) {
    path = join(path, part);
    entry = lstatSync(path);
    if (entry.isSymbolicLink()) throw new Error('symbolic link in release candidate path');
    if (index < parts.length - 1 ? !entry.isDirectory() : !entry.isFile()) {
      throw new Error('release candidate is not a regular file');
    }
  }
  const resolved = realpathSync(path);
  const resolvedName = relative(canonicalRoot, resolved).split(sep).join('/');
  if (!resolvedName || resolvedName === '..' || resolvedName.startsWith('../') || isAbsolute(resolvedName)) {
    throw new Error('release candidate is outside the repository');
  }
  if (isPrivate(resolvedName)) throw new Error('private runtime file tracked');
  return { path: resolved, dev: entry.dev, ino: entry.ino };
}

/** Open only the checked regular file; do not follow a final symlink introduced after validation. */
export function readReleaseFile(root, file) {
  const checked = validateReleaseFile(root, file);
  const descriptor = openSync(checked.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = fstatSync(descriptor);
    const current = validateReleaseFile(root, file);
    if (!opened.isFile() || opened.dev !== checked.dev || opened.ino !== checked.ino
      || current.dev !== opened.dev || current.ino !== opened.ino || current.path !== checked.path) {
      throw new Error('release candidate changed while opening');
    }
    return readFileSync(descriptor, 'utf8');
  } finally { closeSync(descriptor); }
}

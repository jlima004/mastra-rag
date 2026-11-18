#!/usr/bin/env node
// H5 operator-only launcher. Read a local ignored .env as DATA, never source it.
// Forward ONLY SUPABASE_DB_PASSWORD from .env, not other .env values.
// This launcher must not run in CI against a real Supabase project.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

function stop(code) {
  process.stderr.write(code + '\n');
  process.exit(2);
}

if (process.argv.length !== 3 || process.argv[2] !== '--read-only') {
  stop('E1_H5_OPERATOR_LAUNCHER_REQUIRES_READ_ONLY_FLAG');
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dotenv = path.join(root, '.env');
let fromFile;

if (existsSync(dotenv)) {
  try {
    const stat = lstatSync(dotenv);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      stop('E1_H5_DOTENV_MUST_BE_REGULAR_FILE');
    }
    // The postgres password is privileged; don't accept a group/world-readable file.
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      stop('E1_H5_DOTENV_FILE_PERMISSIONS_UNSAFE__CHMOD_600');
    }
    // Do not accidentally use a secret from a tracked .env file.
    const check = spawnSync('git', ['ls-files', '--error-unmatch', '--', '.env'], {
      cwd: root,
      stdio: 'ignore',
    });
    if (check.error || ![0, 1].includes(check.status)) {
      stop('E1_H5_DOTENV_GIT_TRACKING_CHECK_FAILED');
    }
    if (check.status === 0) {
      stop('E1_H5_DOTENV_MUST_NOT_BE_TRACKED');
    }
    const parsed = parseEnv(readFileSync(dotenv, 'utf8'));
    fromFile = parsed.SUPABASE_DB_PASSWORD;
  } catch {
    stop('E1_H5_DOTENV_COULD_NOT_BE_READ_SAFELY');
  }
}

const inherited = process.env.SUPABASE_DB_PASSWORD;
if (inherited && fromFile && inherited !== fromFile) {
  stop('E1_H5_DB_PASSWORD_ENV_FILE_CONFLICT');
}
const password = inherited || fromFile;
if (typeof password !== 'string' || password.length === 0 || password.includes('\0')) {
  stop('E1_H5_DB_PASSWORD_MISSING_OR_INVALID');
}

// Preserve ordinary caller environment, but NEVER import any other key from .env.
// Password goes via child environment, not argv, stdout or a generated file.
const child = spawnSync('bash', [path.join(root, 'scripts/e1-h5-remote-history-readonly.sh'), '--read-only'], {
  cwd: root,
  env: { ...process.env, SUPABASE_DB_PASSWORD: password },
  stdio: 'inherit',
});
if (child.error) {
  stop('E1_H5_OPERATOR_BASH_LAUNCH_FAILED');
}
process.exit(child.status ?? 2);

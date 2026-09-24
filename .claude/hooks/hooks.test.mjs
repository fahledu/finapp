// Regression tests for the agent hooks. Run: node --test .claude/hooks/hooks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const dir = import.meta.dirname;
const root = path.resolve(dir, '../..');

function run(script, args, toolInput) {
  const result = spawnSync(process.execPath, [path.join(dir, script), ...args], {
    input: JSON.stringify({ tool_input: toolInput, cwd: root }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf8',
  });
  return result.status;
}

const bash = (command) => run('readonly-bash.mjs', [], { command });

test('readonly-bash allows read-only commands', () => {
  for (const cmd of [
    'git status --short',
    'git diff HEAD | head -50',
    'git log --oneline -5',
    'git diff --no-ext-diff',
    'rg -n foo src',
    'pnpm test',
    'pnpm -F api lint',
    'TZ=UTC pnpm test',
    'ls docs 2>/dev/null',
  ]) {
    assert.equal(bash(cmd), 0, cmd);
  }
});

test('readonly-bash blocks writes and program execution', () => {
  for (const cmd of [
    'cat a > b',
    'echo x >> file',
    'cat <(touch pwned)',
    'echo $(rm -rf x)',
    'echo `rm -rf x`',
    'rg --pre ./evil.sh foo',
    'sort --compress-program=sh x',
    'sort -o out in',
    'git diff --ext-diff',
    'git log --textconv -p',
    'git diff --output=x',
    'git grep -O foo',
    'find . -delete',
    'find . -exec rm {} ;',
    'pnpm lint --fix',
    'pnpm test -u',
    'rm -rf x',
    'node script.js',
    'git commit -m x',
    'git -c core.pager=sh log',
  ]) {
    assert.equal(bash(cmd), 2, cmd);
  }
});

const guard = (args, filePath) => run('guard-paths.mjs', args, { file_path: filePath });

test('guard-paths deny rules', () => {
  const args = ['--deny', 'apps/api/prisma/', '--deny', '.claude/', '--deny', 'docs/adr/'];
  assert.equal(guard(args, 'apps/api/src/app.ts'), 0);
  assert.equal(guard(args, 'docs/plans/x.md'), 0);
  assert.equal(guard(args, 'apps/api/prisma/schema.prisma'), 2);
  assert.equal(guard(args, path.join(root, 'apps/api/prisma/schema.prisma')), 2);
  assert.equal(guard(args, '.claude/hooks/guard-paths.mjs'), 2);
  assert.equal(guard(args, 'docs/adr/0001-x.md'), 2);
});

test('guard-paths allow rules with deny exception (docs agent)', () => {
  const args = ['--allow', 'docs/', '--allow', 'README.md', '--allow', 'CLAUDE.md', '--allow', 'GUIA.md', '--deny', 'docs/adr/'];
  assert.equal(guard(args, 'docs/STATUS.md'), 0);
  assert.equal(guard(args, 'README.md'), 0);
  assert.equal(guard(args, 'docs/adr/0001-x.md'), 2);
  assert.equal(guard(args, 'apps/web/src/main.tsx'), 2);
  assert.equal(guard(args, 'packages/shared/src/money.ts'), 2);
});

test('guard-paths rejects malformed arguments', () => {
  assert.equal(guard(['--allow'], 'docs/x.md'), 2);
  assert.equal(guard(['--other', 'x'], 'docs/x.md'), 2);
});

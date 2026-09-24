// Stop / SubagentStop hook: if docs or agent files changed, run scripts/check-docs.mjs.
// Exit 2 keeps the agent working until the docs agree again. When the hook already
// forced one continuation (stop_hook_active), it only warns, to avoid a loop.
import { execFileSync, spawnSync } from 'node:child_process';

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

const input = JSON.parse((await readStdin()) || '{}');
const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();

let changed = '';
try {
  changed = execFileSync(
    'git',
    ['status', '--porcelain', '--', 'docs', 'CLAUDE.md', 'GUIA.md', 'README.md', '.claude/agents'],
    { cwd: root, encoding: 'utf8' },
  );
} catch {
  process.exit(0); // not a git repo or git missing: nothing to check
}
if (!changed.trim()) process.exit(0);

const result = spawnSync(process.execPath, ['scripts/check-docs.mjs'], { cwd: root, encoding: 'utf8' });
if (result.status === 0) process.exit(0);

const message =
  `${result.stderr || result.stdout}\n` +
  'A documentação ficou inconsistente. Corrija os itens acima (ou delegue ao agente responsável) antes de encerrar.';
if (input.stop_hook_active) {
  process.stderr.write(`${message}\n(aviso: já houve uma continuação forçada; não bloqueando de novo)\n`);
  process.exit(0);
}
process.stderr.write(`${message}\n`);
process.exit(2);

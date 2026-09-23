// PreToolUse hook (Edit|Write|NotebookEdit): restricts which paths a subagent may change.
//
// Usage in agent frontmatter:
//   node guard-paths.mjs --allow docs/                (only paths under docs/)
//   node guard-paths.mjs --deny apps/api/prisma/      (anything except apps/api/prisma/)
// A rule ending in "/" matches a directory prefix; otherwise it matches one file.
// Exit 2 blocks the tool call and sends stderr back to the agent.
import path from 'node:path';

function block(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function normalize(p) {
  const slashed = p.replaceAll('\\', '/').replace(/^\.\//, '');
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed;
}

function matches(rel, rule) {
  return rule.endsWith('/') ? rel.startsWith(rule) : rel === rule;
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

const rules = { allow: [], deny: [] };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const kind = args[i]?.replace(/^--/, '');
  const value = args[i + 1];
  if ((kind !== 'allow' && kind !== 'deny') || !value) {
    block(`guard-paths: invalid arguments: ${args.join(' ')}`);
  }
  rules[kind].push(normalize(value));
}

const input = JSON.parse(await readStdin());
const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
if (!target) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
const rel = normalize(path.relative(root, path.resolve(root, target)));

const denied = rules.deny.find((rule) => matches(rel, rule));
if (denied) {
  block(
    `Bloqueado: este agente não pode alterar "${rel}" (regra --deny ${denied}). ` +
      'Descreva a mudança necessária no seu resumo para o agente responsável.',
  );
}

if (rules.allow.length > 0 && !rules.allow.some((rule) => matches(rel, rule))) {
  block(
    `Bloqueado: este agente só pode alterar ${rules.allow.join(', ')}; "${rel}" está fora.`,
  );
}

process.exit(0);

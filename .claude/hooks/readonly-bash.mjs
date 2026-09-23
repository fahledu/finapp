// PreToolUse hook (Bash): allows only read-only commands, for review agents.
//
// Allowlist, not blocklist: anything not recognized is blocked. The command is
// split on &&, ||, ;, | and newlines; every segment must be allowed. Splitting
// ignores quotes, so a quoted "|" may cause a false block; that is intentional
// (fail closed).
// Exit 2 blocks the tool call and sends stderr back to the agent.

const ALLOWED = [
  /^cd\b/,
  /^git (status|diff|log|show|blame|rev-parse|ls-files|grep|shortlog)\b/,
  /^git branch( (--show-current|-a|--all|-r|--remotes|-v|-vv|--list))*$/,
  /^git config (--get|--get-all|--list|-l)\b/,
  /^pnpm (audit|outdated|why|ls|list|lint|typecheck|test|e2e)\b/,
  /^pnpm (-F|--filter) \S+ (audit|outdated|why|ls|list|lint|typecheck|test)\b/,
  /^(ls|cat|head|tail|wc|grep|rg|sort|uniq|pwd|find)\b/,
];

const FORBIDDEN = [
  { pattern: /`|\$\(/, reason: 'substituição de comando' },
  { pattern: /--fix\b/, reason: '--fix altera arquivos' },
  { pattern: /--output\b/, reason: '--output grava arquivo' },
  { pattern: /\s-(delete|exec|execdir|ok)\b/, reason: 'find com ação' },
  { pattern: /(^|[^0-9&])>(?!\s*&\d)(?!\s*\/dev\/null)/, reason: 'redirecionamento para arquivo' },
  { pattern: /\d>(?!&\d)(?!\s*\/dev\/null)/, reason: 'redirecionamento para arquivo' },
  { pattern: /&>(?!\s*\/dev\/null)/, reason: 'redirecionamento para arquivo' },
];

function block(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

const input = JSON.parse(await readStdin());
const command = String(input.tool_input?.command ?? '').trim();
if (!command) process.exit(0);

for (const { pattern, reason } of FORBIDDEN) {
  if (pattern.test(command)) {
    block(`Bloqueado (${reason}): este agente é somente leitura. Comando: ${command}`);
  }
}

const segments = command
  .split(/&&|\|\||;|\||\n/)
  .map((s) => s.trim().replace(/^(\w+=\S*\s+)+/, '')) // drop env prefixes like TZ=UTC
  .filter(Boolean);

const rejected = segments.find((s) => !ALLOWED.some((re) => re.test(s)));
if (rejected) {
  block(
    `Bloqueado: "${rejected}" não está na lista de comandos somente leitura ` +
      '(git status/diff/log/show/blame, pnpm audit/lint/typecheck/test, ls/cat/grep...). ' +
      'Este agente não altera o repositório.',
  );
}

process.exit(0);

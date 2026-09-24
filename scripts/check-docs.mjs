// Checks that project docs agree with each other. Exit 1 lists every problem.
//
// - every ADR file is in the index (docs/adr/README.md) with the same status, and vice versa
// - every relative .md link resolves
// - every "ADR NNNN" / "ADRs NNNN e NNNN" mention points to an existing ADR
//
// Usage: node scripts/check-docs.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const adrDir = path.join(root, 'docs/adr');
const problems = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function listMarkdown(relDir) {
  const dir = path.join(root, relDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const rel = path.posix.join(relDir, e.name);
      if (e.isDirectory()) return e.name.startsWith('_') ? [] : listMarkdown(rel);
      return e.name.endsWith('.md') ? [rel] : [];
    });
}

// ADR files and their status lines
const adrs = new Map();
for (const name of fs.readdirSync(adrDir)) {
  const m = name.match(/^(\d{4})-.+\.md$/);
  if (!m) continue;
  if (adrs.has(m[1])) problems.push(`ADR ${m[1]} duplicado: ${adrs.get(m[1]).file} e ${name}`);
  const status = read(`docs/adr/${name}`).match(/^- Status: (.+)$/m)?.[1]?.trim();
  if (!status) problems.push(`docs/adr/${name}: sem linha "- Status:"`);
  adrs.set(m[1], { file: name, status });
}

// Index rows: | [NNNN](file) | title | status |
const indexed = new Map();
for (const row of read('docs/adr/README.md').matchAll(/^\| \[(\d{4})\]\(([^)]+)\) \| [^|]+ \| ([^|]+) \|$/gm)) {
  indexed.set(row[1], { file: row[2], status: row[3].trim() });
}
for (const [num, adr] of adrs) {
  const row = indexed.get(num);
  if (!row) problems.push(`ADR ${num} (${adr.file}) não está no índice`);
  else if (row.file !== adr.file) problems.push(`índice aponta ADR ${num} para ${row.file}, arquivo é ${adr.file}`);
  else if (adr.status && adr.status.split(/[\s,(]/)[0] !== row.status.split(/[\s,(]/)[0]) {
    problems.push(`ADR ${num}: status "${adr.status}" no arquivo, "${row.status}" no índice`);
  }
}
for (const num of indexed.keys()) {
  if (!adrs.has(num)) problems.push(`índice lista ADR ${num}, que não existe`);
}

// Links and ADR mentions in every doc the agents read
const docs = [
  'CLAUDE.md',
  'GUIA.md',
  'README.md',
  ...listMarkdown('docs'),
  ...listMarkdown('.claude/agents'),
].filter((rel) => fs.existsSync(path.join(root, rel)));

for (const rel of docs) {
  const text = read(rel);
  for (const [, target] of text.matchAll(/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g)) {
    if (/^[a-z]+:/i.test(target)) continue;
    if (!fs.existsSync(path.resolve(path.dirname(path.join(root, rel)), target))) {
      problems.push(`${rel}: link quebrado para ${target}`);
    }
  }
  for (const [mention] of text.matchAll(/\bADRs? \d{4}(?:(?:, | e | ou )\d{4})*/g)) {
    for (const [num] of mention.matchAll(/\d{4}/g)) {
      if (!adrs.has(num)) problems.push(`${rel}: cita ADR ${num}, que não existe`);
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`check-docs: ${problems.length} problema(s)\n- ${problems.join('\n- ')}\n`);
  process.exit(1);
}
console.log(`check-docs: ok (${adrs.size} ADRs, ${docs.length} arquivos)`);

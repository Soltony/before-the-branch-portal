import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawPath = path.join(__dirname, 'branch-list.tsv');
const raw = fs.readFileSync(rawPath, 'utf8');
const lines = raw.trim().split(/\r?\n/).filter(Boolean);

const branches = lines.map((line) => {
  const tab = line.indexOf('\t');
  const id = tab >= 0 ? line.slice(0, tab).trim() : line.split(/\s+/)[0];
  const name = tab >= 0 ? line.slice(tab + 1).trim() : line.slice(id.length).trim();
  const code = parseInt(id.replace(/^ET0010/, ''), 10);
  return { id, code, name };
});

const content = `export type Branch = { id: string; code: number; name: string };

export const BRANCHES: Branch[] = ${JSON.stringify(branches, null, 2)};

export function branchIdToCode(branchId: string): number {
  return parseInt(branchId.replace(/^ET0010/, ''), 10);
}

export function branchCodeToId(code: number): string {
  return \`ET0010\${String(code).padStart(3, '0')}\`;
}

export function getBranchLabel(code: number | null | undefined): string {
  if (code == null) return 'N/A';
  const branch = BRANCHES.find((b) => b.code === code);
  return branch ? \`\${branch.id} - \${branch.name}\` : String(code);
}
`;

const outPath = path.join(__dirname, '..', 'src', 'lib', 'branches.ts');
fs.writeFileSync(outPath, content);
console.log(`Wrote ${branches.length} branches to ${outPath}`);

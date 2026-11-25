import type { TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { formatBrief, forwardSlashes, needsBrief, type JanklessResult } from 'jankless';

const quote = (s: string) => (/^[\w./:@=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export function rerunCommand(testInfo: TestInfo, cwd = process.cwd()): string {
  const file = forwardSlashes(relative(cwd, testInfo.file));
  const project = testInfo.project.name ? ` --project=${quote(testInfo.project.name)}` : '';
  return `npx playwright test ${quote(`${file}:${testInfo.line}`)}${project}`;
}

export async function writeBrief(
  testInfo: TestInfo,
  label: string,
  resultFile: string,
  result: JanklessResult,
  comparison = result.comparison,
) {
  if (!comparison || !needsBrief(comparison)) return;
  const file = resultFile.replace(/\.json$/, '.fix.md');
  writeFileSync(file, formatBrief(result, comparison, { rerun: rerunCommand(testInfo), resultFile }));
  await testInfo.attach(`jankless fix brief: ${label}`, { path: file, contentType: 'text/markdown' });
}

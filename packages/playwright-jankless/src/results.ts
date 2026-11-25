// Reading a Playwright run's jankless results back from its output folder.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { JanklessResult, ReportEntry } from 'jankless';

export function filesEndingIn(dir: string, ending: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? filesEndingIn(p, ending) : p.endsWith(ending) ? [p] : [];
  });
}

export const jsonFiles = (dir: string) => filesEndingIn(dir, '.json');

export function latestAttempts(files: string[]): string[] {
  const latest = new Map<string, { retry: number; files: string[] }>();
  for (const file of files) {
    const dir = dirname(file);
    const m = /^(.*)-retry(\d+)$/.exec(basename(dir));
    const key = m ? join(dirname(dir), m[1]!) : dir;
    const retry = m ? Number(m[2]) : 0;
    const seen = latest.get(key);
    if (!seen || retry > seen.retry) latest.set(key, { retry, files: [file] });
    else if (retry === seen.retry) seen.files.push(file);
  }
  return [...latest.values()].flatMap(({ files }) => files.sort());
}

export function readResults(results: string): ReportEntry[] {
  const entries: ReportEntry[] = [];
  for (const file of latestAttempts(jsonFiles(join(results, 'jankless')))) {
    try {
      const r = JSON.parse(readFileSync(file, 'utf8')) as JanklessResult;
      if (r.schemaVersion !== 1 || typeof r.label !== 'string') continue;
      entries.push({
        test: r.test?.title ?? basename(dirname(file)),
        file: r.test?.file ?? '',
        project: r.test?.project ?? '',
        result: r,
      });
    } catch {
      continue;
    }
  }
  return entries;
}

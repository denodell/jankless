// Copies the license and the package's README into a package folder before `npm pack` or
// `npm publish`. playwright-jankless gets the repository's README; jankless has its own.
// Run by each package's prepack script: node ../../scripts/copy-package-docs.mjs <package>
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_URL = 'https://github.com/denodell/jankless';
const RAW_URL = 'https://raw.githubusercontent.com/denodell/jankless/main';

export function absoluteLinks(markdown) {
  return markdown.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (match, image, text, target) => {
    if (/^([a-z]+:|#|\/)/i.test(target)) return match;
    const url = image ? `${RAW_URL}/${target}` : `${REPO_URL}/blob/main/${target}`;
    return `${image}[${text}](${url})`;
  });
}

const repo = join(import.meta.dirname, '..');
const pkg = process.argv[2];
if (pkg) {
  const dir = join(repo, 'packages', pkg);
  copyFileSync(join(repo, 'LICENSE'), join(dir, 'LICENSE'));
  if (pkg === 'playwright-jankless') {
    writeFileSync(join(dir, 'README.md'), absoluteLinks(readFileSync(join(repo, 'README.md'), 'utf8')));
  }
}

import { defineConfig } from 'tsup';

// jankless and puppeteer-core are dependencies, so they stay imports.
export default defineConfig({
  entry: { index: 'src/index.ts', adapter: 'src/adapter.ts' },
  format: ['esm', 'cjs'],
  sourcemap: true,
  target: 'node20',
  tsconfig: 'tsconfig.build.json',
  external: ['jankless', 'puppeteer-core'],
  // tsup's declaration build sets `baseUrl` internally, which TypeScript 6 deprecates.
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: true,
});

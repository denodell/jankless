import { defineConfig, type Options } from 'tsup';

const shared: Options = {
  sourcemap: true,
  // The maps point at the original files without carrying their text, which would add the
  // embedded replay font (replay/font.ts) to every map.
  esbuildOptions(options) {
    options.sourcesContent = false;
  },
  target: 'node20',
  tsconfig: 'tsconfig.build.json',
};

export default defineConfig([
  {
    ...shared,
    // adhoc and cli are their own entries: jankless/adhoc and jankless/cli.
    entry: { index: 'src/index.ts', adhoc: 'src/adhoc.ts', cli: 'src/cli/cli.ts' },
    format: ['esm', 'cjs'],
    // tsup's declaration build sets `baseUrl` internally, which TypeScript 6 deprecates.
    dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
    clean: true,
  },
  // The command is only run through `bin`, so it needs neither CommonJS nor types.
  { ...shared, entry: { bin: 'src/cli/bin.ts' }, format: ['esm'] },
]);

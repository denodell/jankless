import { defineConfig, type Options } from 'tsup';

// playwright-butter and the MCP SDK are dependencies, so they stay imports.
const shared: Options = {
  format: ['esm'],
  sourcemap: true,
  target: 'node20',
  tsconfig: 'tsconfig.build.json',
};

export default defineConfig([
  {
    ...shared,
    entry: { server: 'src/server.ts' },
    // tsup's declaration build sets `baseUrl` internally, which TypeScript 6 deprecates.
    dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
    clean: true,
  },
  // Only run through `bin`, so it needs no types.
  { ...shared, entry: { bin: 'src/bin.ts' } },
]);

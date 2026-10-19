import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/mcp.ts', 'src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  dts: { entry: 'src/index.ts' },
  clean: true,
  sourcemap: true,
  splitting: true,
});

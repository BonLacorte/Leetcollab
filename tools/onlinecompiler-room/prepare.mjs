import { cp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('.onlinecompiler-room');
await mkdir(`${root}/web`, { recursive: true });
for (const item of ['src', 'public', 'package.json', 'tsconfig.json', 'postcss.config.mjs', 'next-env.d.ts']) {
  try { await cp(`apps/web/${item}`, `${root}/web/${item}`, { recursive: true, filter: path => !/\.test\.[tj]sx?$/.test(path) }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await symlink(resolve('apps/web/node_modules'), `${root}/web/node_modules`, 'dir').catch(error => { if (error.code !== 'EEXIST') throw error; });
await writeFile(`${root}/web/next.config.ts`, 'export default { transpilePackages: ["@leetcollab/contracts"], devIndicators: false };\n');
await cp('tools/onlinecompiler-room/fixture-context.ts', `${root}/web/src/lib/server/judge/fixture-context.ts`);
await writeFile(`${root}/web/src/lib/server/judge/context.ts`, 'export { getJudgeService } from "./fixture-context";\n');
const tsconfig = JSON.parse(await readFile(`${root}/web/tsconfig.json`, 'utf8'));
tsconfig.exclude = [...(tsconfig.exclude ?? []), '**/*.test.ts', '**/*.test.tsx'];
await writeFile(`${root}/web/tsconfig.json`, JSON.stringify(tsconfig, null, 2) + '\n');
const layout = `${root}/web/src/app/layout.tsx`;
await writeFile(layout, (await readFile(layout, 'utf8')).replace('<ThemeProvider>', '<p role="status">Private trusted-fixture evaluation - production execution remains disabled.</p><ThemeProvider>'));
console.log('Prepared isolated fixture copy under .onlinecompiler-room/web');

import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
await build({entryPoints:['scripts/check-client-documents.tsx'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'node_modules/.cache/check-client-documents.mjs'});
const result=spawnSync(process.execPath,['node_modules/.cache/check-client-documents.mjs'],{stdio:'inherit'});
process.exit(result.status ?? 1);

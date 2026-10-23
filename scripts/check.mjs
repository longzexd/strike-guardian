import {readdir} from 'node:fs/promises';import {spawnSync} from 'node:child_process';
for(const file of ['server.mjs',...(await readdir('dist')).filter(f=>f.endsWith('.mjs')).map(f=>'dist/'+f)]){const r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status)process.exit(r.status)}console.log('All application modules pass syntax checks');

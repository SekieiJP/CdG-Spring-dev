import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('開始済みの試験を拒否するとき、実行設定を先に上書きしない',async()=>{
    const root=fileURLToPath(new URL('../../',import.meta.url)),stage='unit-preserve-'+randomUUID(),directory=path.join(root,'solver/local-runs/pro-mean125',stage),temporary=await mkdtemp(path.join(tmpdir(),'cdg-study-'));
    try{
        await mkdir(directory,{recursive:true});const manifest='{"preserve":"old-plan"}',config='preserve old running configuration';
        await writeFile(path.join(directory,'manifest.json'),manifest);await writeFile(path.join(directory,'baseline-config.json'),config);
        const model=path.join(temporary,'model.json'),input=path.join(temporary,'configs.json');await writeFile(model,'{}');await writeFile(input,JSON.stringify({baseline:{valueModelPath:model}}));
        const child=spawnSync(process.execPath,['solver/ahiru-pro-study.mjs',stage,'250','baseline','--configs',input],{cwd:root,encoding:'utf8',timeout:10000});
        assert.equal(child.status,1);assert.match(child.stderr,/既存の実行/);assert.equal(await readFile(path.join(directory,'baseline-config.json'),'utf8'),config);assert.equal(await readFile(path.join(directory,'manifest.json'),'utf8'),manifest);
    }finally{await rm(directory,{recursive:true,force:true});await rm(temporary,{recursive:true,force:true});}
});

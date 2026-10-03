#!/usr/bin/env node
/** 詳細記録を可逆圧縮。展開内容のSHAが一致した場合だけ元ファイルを置き換える。 */
import {createReadStream,createWriteStream} from 'node:fs';
import {rename,unlink} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {createGzip,createGunzip} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';
export async function compressRun(file){
 const target=file+'.gz',temporary=target+'.tmp';
 const hash=async stream=>{const sha=createHash('sha256');for await(const chunk of stream)sha.update(chunk);return sha.digest('hex');};
 const before=await hash(createReadStream(file));
 await pipeline(createReadStream(file),createGzip({level:1}),createWriteStream(temporary,{flags:'wx'}));
 const after=await hash(createReadStream(temporary).pipe(createGunzip()));
 if(before!==after)throw Error('圧縮前後の記録が不一致: '+file);
 await rename(temporary,target);await unlink(file);
 return {file,sha256:before,compressedFile:target};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){
 for(const file of process.argv.slice(2))console.log(JSON.stringify(await compressRun(file)));
}

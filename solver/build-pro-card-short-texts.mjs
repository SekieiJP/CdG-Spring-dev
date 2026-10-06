#!/usr/bin/env node
// Build lossless short effect text from the game's actual parsed PRO effects.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
const {CardManager}=await import(pathToFileURL(path.join(root,'game/js/cardManager.js')));
const csvBytes=await readFile(path.join(root,'game/data/cards_pro.csv'));
const parserBytes=await readFile(path.join(root,'game/js/cardManager.js'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const parser=new CardManager(null);parser.parseCSV(csvBytes.toString('utf8'));
const staffNames={leader:'長',teacher:'講',staff:'事'};
const statNames={experience:'体',enrollment:'入',satisfaction:'満',accounting:'経'};
const tokenNames={passion:'✊',inspiration:'💡',organize:'🗑️',fatigue:'💤'};
const reverse=m=>Object.fromEntries(Object.entries(m).map(([key,value])=>[value,key]));
const staffKeys=reverse(staffNames),statKeys=reverse(statNames),tokenKeys=reverse(tokenNames);
function conditionText(c){
 if(c.type==='staff')return c.staffList.map(s=>staffNames[s]).join('');
 if(c.type==='status')return statNames[c.status]+(c.comparison==='gte'?'≥':'≤')+c.value;
 if(c.type==='remainingTurns')return '残≥'+c.value+'T';
 throw Error('Unsupported effect condition: '+JSON.stringify(c));
}
function effectsText(effects){
 const result=[];
 if(effects.some(e=>e.type==='immediate'&&e.effect==='parallel'))result.push('🤹');
 for(const token of ['fatigue','passion','inspiration','organize']){
  const count=effects.filter(e=>e.type==='token'&&e.token===token).length;
  if(count)result.push(tokenNames[token]+(count>1?'×'+count:''));
 }
 for(const e of effects){
  if(e.type==='change')result.push((e.value<0?'[!]':'')+statNames[e.status]+(e.value<0?'−'+(-e.value):e.value));
  else if(e.type==='set')result.push(statNames[e.status]+'='+e.value);
  else assert.ok(e.type==='token'||(e.type==='immediate'&&e.effect==='parallel'));
 }
 return result.join(', ');
}
function summarize(parsed){
 const restriction=parsed.staffRestrictions.length?'['+parsed.staffRestrictions.map(s=>staffNames[s]).join('')+']':'';
 const base=effectsText(parsed.baseEffects);
 const lines=[];
 if(restriction||base)lines.push([restriction,base].filter(Boolean).join(' '));
 for(const block of parsed.conditionalBlocks)lines.push('〈'+conditionText(block.condition)+'〉'+effectsText(block.effects));
 return lines.join('\n');
}
function readCondition(text){
 if(/^[長講事]+$/.test(text))return {type:'staff',staffList:Array.from(text).map(s=>staffKeys[s])};
 let m=text.match(/^([体入満経])([≥≤])(\d+)$/);
 if(m)return {type:'status',status:statKeys[m[1]],value:Number(m[3]),comparison:m[2]==='≥'?'gte':'lte'};
 m=text.match(/^残≥(\d+)T$/);if(m)return {type:'remainingTurns',value:Number(m[1])};
 throw Error('Unsupported short condition: '+text);
}
function readEffects(text){
 if(!text)return [];
 return text.split(', ').flatMap(part=>{
  if(part==='🤹')return [{type:'immediate',effect:'parallel'}];
  const [symbol,count]=part.split('×');
  if(tokenKeys[symbol])return Array.from({length:count?Number(count):1},()=>({type:'token',token:tokenKeys[symbol]}));
  const m=part.match(/^(\[!\])?([体入満経])(=|−)?(\d+)$/);
  assert.ok(m,'Unrecognized short effect: '+part);
  if(m[3]==='=')return [{type:'set',status:statKeys[m[2]],value:Number(m[4])}];
  assert.equal(Boolean(m[1]),m[3]==='−','Cost marker must accompany a negative effect');
  return [{type:'change',status:statKeys[m[2]],value:Number(m[4])*(m[3]==='−'?-1:1)}];
 });
}
function readSummary(text){
 const result={staffRestrictions:[],baseEffects:[],conditionalBlocks:[]};
 const lines=text.split('\n');
 const restriction=lines[0].match(/^\[([長講事]+)\] ?/);
 if(restriction){result.staffRestrictions=Array.from(restriction[1]).map(s=>staffKeys[s]);lines[0]=lines[0].slice(restriction[0].length);}
 for(const line of lines){
  if(!line)continue;
  const m=line.match(/^〈([^〉]+)〉(.*)$/);
  if(m)result.conditionalBlocks.push({condition:readCondition(m[1]),effects:readEffects(m[2])});
  else result.baseEffects.push(...readEffects(line));
 }
 return result;
}
const canonicalEffects=effects=>effects.map(e=>JSON.stringify(e)).sort();
const canonical=p=>({staffRestrictions:p.staffRestrictions,baseEffects:canonicalEffects(p.baseEffects),conditionalBlocks:p.conditionalBlocks.map(b=>({condition:b.condition,effects:canonicalEffects(b.effects)}))});
const cards=parser.allCards.map(card=>{
 const parsed=parser.parseEffect(card.effect),topText=summarize(parsed);
 assert.deepEqual(canonical(readSummary(topText)),canonical(parsed));
 return {cardNo:Number(card.cardNo),effect:card.effect,topText,roundTripVerified:true};
});
assert.deepEqual(cards.map(c=>c.cardNo).sort((a,b)=>a-b),Array.from({length:51},(_,i)=>i+1));
const result={date:'2026-10-06',method:'本体のCardManager.parseEffectが返す配置制限・基本効果・条件付き効果から短縮表示を作成し、再解析して全51枚の効果を照合。',cardsSha256:sha(csvBytes),parserSha256:sha(parserBytes),legend:'長=室長、講=講師、事=事務。体=体験、入=入塾、満=満足、経=経理。［］は配置制限、〈〉は発動条件。条件付きの行は基本効果に追加する。[!]は支払い、×は個数。',cards};
await writeFile(path.join(root,'docs/pro-card-tier/effect-short-texts.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({cards:cards.length,roundTripVerified:cards.length,card48:cards.find(c=>c.cardNo===48).topText,card49:cards.find(c=>c.cardNo===49).topText,card36:cards.find(c=>c.cardNo===36).topText},null,2));

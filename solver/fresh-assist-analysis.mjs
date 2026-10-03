/** 状況別の取得評価と、同seedのS率・中央値比較。ゲームの判断・操作は行わない。 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { recordsFrom } from './card-evaluation.mjs';
const quantile=(values,q)=>{const a=[...values].sort((a,b)=>a-b);return a[Math.max(0,Math.ceil(a.length*q)-1)]??null;};
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
const isS=r=>['S','S+'].includes(r.result?.score?.rank?.grade);
const score=r=>Number(r.result?.score?.displayScore);
function wilson(success,n){
    if(!n)return [null,null]; const z=1.96,p=success/n,d=1+z*z/n;
    const middle=(p+z*z/(2*n))/d,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
    return [middle-half,middle+half];
}
function random(seed=874923){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
export function pairedComparison(before,after,iterations=2000){
    const old=new Map(before.map(r=>[r.metadata.seed,r]));
    const pairs=after.filter(r=>old.has(r.metadata.seed)).map(r=>[old.get(r.metadata.seed),r]);
    if(!pairs.length)return null;
    const rng=random(),sr=[],med=[];
    for(let k=0;k<iterations;k++){
        const sampled=Array.from({length:pairs.length},()=>pairs[Math.floor(rng()*pairs.length)]);
        sr.push(mean(sampled.map(([a,b])=>Number(isS(b))-Number(isS(a)))));
        med.push(quantile(sampled.map(([,b])=>score(b)),.5)-quantile(sampled.map(([a])=>score(a)),.5));
    }
    return {n:pairs.length,sRateDifference:mean(pairs.map(([a,b])=>Number(isS(b))-Number(isS(a)))),
        sRateDifference95:[quantile(sr,.025),quantile(sr,.975)],
        medianDifference:quantile(pairs.map(([,r])=>score(r)),.5)-quantile(pairs.map(([r])=>score(r)),.5),
        medianDifference95:[quantile(med,.025),quantile(med,.975)], improvedToS:pairs.filter(([a,b])=>!isS(a)&&isS(b)).length,
        lostS:pairs.filter(([a,b])=>isS(a)&&!isS(b)).length};
}
function deficit(stats){const w=Math.max(0,15-stats.satisfaction)+Math.max(0,15-stats.accounting);
    return w>1?'退塾抑制':stats.experience<12?'体験不足':stats.enrollment-w<12?'入退差不足':'S条件成立';}
export function summarize(records){
    const groups=new Map(),rows=new Map(),examples=[];
    for(const record of records){
        const meta=record.metadata;
        if(meta.difficulty!=='fresh'||meta.calcMode||meta.eventId||!record.result||!Number.isFinite(score(record)))continue;
        const decisions=record.events.filter(event=>event.type==='acquisition-decision');
        const manual=meta.source==='human'||!meta.acquisitionModel&&decisions.some(event=>Object.hasOwn(event,'assistEnabled'));
        const exposure=manual?(!decisions.length?'取得判断の記録なし':decisions.every(event=>event.assistShown)?'全取得で表示':decisions.some(event=>event.assistShown)?'一部取得で表示':'表示なし'):null;
        const model=manual?'manual':meta.acquisitionModel||'baseline';
        const continuation=meta.continuationPolicy||meta.strategy;
        const label=meta.source==='counterfactual'?`状況再試行:${(meta.forcedChoice||[]).join(',')||'skip'}/${model}`:
            manual?`プレイヤー/${exposure}@${continuation}`:`${model}/${meta.acquisitionAblation||'full'}@${continuation}`;
        const stage=manual||meta.source==='human'?'player-records':String(meta.seed).replace(/:\d+$/,'');
        const key=JSON.stringify([stage,label,meta.cardVersion,meta.rankVersion,meta.rulesVersion,meta.codeVersion,meta.provenance?.codeHash]);
        if(!groups.has(key))groups.set(key,{id:groups.size,label:`${stage}: ${label}`,model,continuation,stage,metadata:{...meta,assistExposure:exposure,catalog:undefined,randomState:undefined},records:[],seen:new Map()});
        const group=groups.get(key),previous=group.seen.get(meta.seed);
        if(previous){
            if(score(previous)!==score(record)||isS(previous)!==isS(record))throw new Error(`同一条件・seedの結果が競合しています: ${meta.seed}`);
            continue;
        }
        group.seen.set(meta.seed,record);group.records.push(record);
        let decisionIndex=0;
        for(const event of record.events){
            if(event.type!=='acquisition-decision')continue;
            const context=event.observation;
            const bucket=deficit(context.stats);
            const exampleId=`${group.id}:${meta.seed}:${decisionIndex++}`;
            const representative=!examples.some(e=>e.group===group.id&&e.turn===context.turn&&e.bucket===bucket);
            if(representative)examples.push({id:exampleId,group:group.id,seed:meta.seed,turn:context.turn,bucket,score:score(record),s:isS(record),...event});
            for(let index=0;index<context.candidates.length;index++){
                const card=context.candidates[index];
                const evaluation=event.advice?.evaluations.find(item=>item.indices.includes(index));
                const rowKey=JSON.stringify([group.id,card.cardNo,context.turn,bucket]);
                if(!rows.has(rowKey))rows.set(rowKey,{group:group.id,cardNo:card.cardNo,name:card.cardName,turn:context.turn,bucket,offers:0,picked:0,
                    scoreSum:0,sCount:0,valueSum:0,contributions:{},features:{},stats:{},deckSizeSum:0,exampleIds:[]});
                const row=rows.get(rowKey); row.offers++; row.picked+=Number(event.chosenIndices.includes(index));
                row.scoreSum+=score(record);row.sCount+=Number(isS(record));row.valueSum+=evaluation?.score||0;row.deckSizeSum+=context.owned.length;
                for(const [key,value]of Object.entries(evaluation?.contributions||{}))row.contributions[key]=(row.contributions[key]||0)+value;
                for(const [key,value]of Object.entries(evaluation?.features||{}))row.features[key]=(row.features[key]||0)+value;
                for(const [key,value]of Object.entries(context.stats))row.stats[key]=(row.stats[key]||0)+value;
                if(representative)row.exampleIds.push(exampleId);
            }
        }
    }
    const results=[...groups.values()].map(group=>{
        const a=group.records.map(score),s=group.records.filter(isS).length;
        return {...group,records:undefined,seen:undefined,n:a.length,sRate:s/a.length,sRate95:wilson(s,a.length),mean:mean(a),median:quantile(a,.5),p10:quantile(a,.1),p90:quantile(a,.9),
            seeds:group.records.map(r=>r.metadata.seed)};
    });
    const comparisons=[];
    for(const group of groups.values()){
        const compatible=[...groups.values()].filter(other=>other.stage===group.stage&&
            other.metadata.cardVersion===group.metadata.cardVersion&&other.metadata.rankVersion===group.metadata.rankVersion&&
            other.metadata.rulesVersion===group.metadata.rulesVersion&&other.metadata.source===group.metadata.source);
        const candidates=compatible.filter(other=>other.model==='baseline');
        candidates.sort((a,b)=>mean(b.records.map(isS))-mean(a.records.map(isS))||
            quantile(b.records.map(score),.5)-quantile(a.records.map(score),.5));
        const reference=candidates[0]||(group.metadata.source==='counterfactual'?compatible[0]:null);
        if(!reference||reference===group)continue;
        const comparison=pairedComparison(reference.records,group.records);
        if(comparison)comparisons.push({before:reference.id,after:group.id,...comparison});
    }
    return {schema:1,groups:results,comparisons,examples,rows:[...rows.values()].map(row=>({...row,scoreMean:row.scoreSum/row.offers,sRate:row.sCount/row.offers,
        valueMean:row.valueSum/row.offers,deckSizeMean:row.deckSizeSum/row.offers,
        contributions:Object.fromEntries(Object.entries(row.contributions).map(([key,value])=>[key,value/row.offers])),
        features:Object.fromEntries(Object.entries(row.features).map(([key,value])=>[key,value/row.offers])),
        stats:Object.fromEntries(Object.entries(row.stats).map(([key,value])=>[key,value/row.offers]))}))};
}
function html(data){
    const embedded=JSON.stringify(data).replace(/</g,'\\u003c');
    return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FRESH取得評価</title>
<style>body{font:15px system-ui;background:#f3f6fb;color:#20304b;margin:20px}table{border-collapse:collapse;background:white}td,th{padding:8px;border:1px solid #ddd;text-align:right}td:nth-child(2){text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}select,input{padding:8px;margin:4px}summary{cursor:pointer}.scroll{overflow:auto}</style>
<h1>FRESH取得評価</h1><p>S率を主目標、中央値を副目標とします。状況別の同伴得点・S率は相関であり、取得したカードだけの効果ではありません。初回はそのカードを含む最良の2枚組の評価値です。</p>
<div id="summary"></div><details><summary>同seedの比較と95%区間</summary><pre id="comparison"></pre></details>
<label>方略<select id="group"></select></label><label>カード<input id="search" placeholder="No・名前"></label><label>状況<select id="bucket"><option value="">すべて</option><option>退塾抑制</option><option>体験不足</option><option>入退差不足</option><option>S条件成立</option></select></label><label>ターン<select id="turn"><option value="">すべて</option>${Array.from({length:8},(_,i)=>`<option value="${i}">${i+1}</option>`).join('')}</select></label>
<details><summary>測定条件</summary><pre id="meta"></pre></details>
<div class="scroll"><table><thead><tr><th>No</th><th>カード・評価内訳</th><th>ターン</th><th>状況</th><th>提示/取得</th><th>評価値</th><th>同伴S率</th><th>同伴得点</th></tr></thead><tbody id="rows"></tbody></table></div>
<h2>状況再試行用の代表例</h2><div id="examples"></div><script>
const data=${embedded};const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const group=document.querySelector('#group'),search=document.querySelector('#search'),bucket=document.querySelector('#bucket'),turn=document.querySelector('#turn');
document.querySelector('#summary').innerHTML='<div class="scroll"><table><tr><th>方略</th><th>n</th><th>S率</th><th>中央値</th><th>p10</th><th>平均</th></tr>'+data.groups.map(g=>'<tr><td>'+esc(g.label)+'</td><td>'+g.n+'</td><td>'+(g.sRate*100).toFixed(1)+'%</td><td>'+g.median+'</td><td>'+g.p10+'</td><td>'+g.mean.toFixed(3)+'</td></tr>').join('')+'</table></div>';
document.querySelector('#comparison').textContent=JSON.stringify(data.comparisons,null,2);
for(const g of data.groups){const o=document.createElement('option');o.value=g.id;o.textContent=g.label;group.append(o)}
if(data.rows.length)group.value=String(data.rows[0].group);
function draw(){const g=data.groups.find(g=>String(g.id)===group.value);if(!g)return;document.querySelector('#meta').textContent=JSON.stringify({...g,metadata:g.metadata,seeds:g.seeds},null,2);
document.querySelector('#rows').innerHTML=data.rows.filter(r=>r.group===g.id&&[r.cardNo,r.name].join(' ').includes(search.value)&&(!bucket.value||r.bucket===bucket.value)&&(!turn.value||String(r.turn)===turn.value)).map(r=>'<tr><td>'+esc(r.cardNo)+'</td><td><details><summary>'+esc(r.name)+'</summary><pre>'+esc(JSON.stringify({寄与:r.contributions,特徴:r.features,平均状態:r.stats,平均デッキ枚数:r.deckSizeMean},null,2))+'</pre></details></td><td>'+(r.turn+1)+'</td><td>'+esc(r.bucket)+'</td><td>'+r.offers+'/'+r.picked+'</td><td>'+r.valueMean.toFixed(2)+'</td><td>'+(r.sRate*100).toFixed(1)+'%</td><td>'+r.scoreMean.toFixed(2)+'</td></tr>').join('');
const host=document.querySelector('#examples');host.replaceChildren();for(const e of data.examples.filter(e=>e.group===g.id&&(!bucket.value||e.bucket===bucket.value)&&(!turn.value||String(e.turn)===turn.value))){const d=document.createElement('details'),s=document.createElement('summary');s.textContent='ターン'+(e.turn+1)+' / '+e.bucket+' / 最終'+e.score+'点';d.append(s);const p=document.createElement('pre');p.textContent=JSON.stringify(e,null,2);d.append(p);const b=document.createElement('button');b.textContent='この状況をJSONで保存';b.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(e,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='fresh-decision.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};d.append(b);host.append(d)}}
for(const el of[group,search,bucket,turn])el.addEventListener('input',draw);draw();</script></html>`;
}
async function main(){
    const args=process.argv.slice(2),files=[];let output='solver/local-evaluation/fresh-assist',extract=null,seed=null,index=0;
    for(let i=0;i<args.length;i++){
        if(args[i]==='--output-dir')output=args[++i];else if(args[i]==='--extract')extract=args[++i];else if(args[i]==='--seed')seed=args[++i];
        else if(args[i]==='--decision')index=Number(args[++i]);else files.push(args[i]);
    }
    if(extract){const records=recordsFrom(JSON.parse(await readFile(resolve(extract),'utf8')));const record=records.find(r=>r.metadata.seed===seed);
        const decision=record?.events.filter(e=>e.type==='acquisition-decision')[index];if(!decision)throw new Error('指定した状況がありません');
        await mkdir(resolve(output),{recursive:true});await writeFile(resolve(output,'decision.json'),JSON.stringify(decision,null,2));return;}
    if(!files.length)throw new Error('入力JSONを指定してください');
    const records=[];for(const file of files)records.push(...recordsFrom(JSON.parse(await readFile(resolve(file),'utf8'))));
    const data=summarize(records);await mkdir(resolve(output),{recursive:true});
    await writeFile(resolve(output,'index.html'),html(data));await writeFile(resolve(output,'summary.json'),JSON.stringify(data,null,2));
    const fields=['group','cardNo','name','turn','bucket','offers','picked','valueMean','scoreMean','sRate','deckSizeMean'];
    const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
    await writeFile(resolve(output,'contexts.csv'),[fields.map(cell).join(','),...data.rows.map(r=>fields.map(k=>cell(r[k])).join(','))].join('\n'));
    for(const g of data.groups)console.log(`${g.label}: n=${g.n}, S=${(100*g.sRate).toFixed(1)}%, median=${g.median}, p10=${g.p10}`);
    console.log(`レポート: ${resolve(output,'index.html')}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();

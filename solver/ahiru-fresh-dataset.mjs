#!/usr/bin/env node
/** 過去FRESHの公開判断を取り出す。カード効果やゲームを再実行しない。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const AXES=['experience','enrollment','satisfaction','accounting'],TOKENS=['passion','fatigue','inspiration','organize'];
const copy=(keys,object)=>Object.fromEntries(keys.map(key=>[key,object[key]]));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const card=c=>({cardNo:c.cardNo,cardName:c.cardName,category:c.category,rarity:c.rarity,effect:c.effect||'',acquiredTurn:c.acquiredTurn||0});
const multiset=cards=>cards.map(c=>[String(c.cardNo),c.effect||'',c.acquiredTurn||0].join('|')).sort();
function publicObservation(o){
    if(o.difficulty!=='fresh'||o.mode!=='normal'||o.totalTurns!==8||!Number.isInteger(o.turn)||o.turn<0||o.turn>7||AXES.some(key=>!Number.isFinite(o.stats?.[key])||o.stats[key]<0)||TOKENS.some(key=>!Number.isInteger(o.tokens?.[key])||o.tokens[key]<0)||o.turns?.length!==8)throw Error('通常FRESHの公開状態が不正');
    return {schema:1,difficulty:'fresh',mode:'normal',turn:o.turn,totalTurns:8,stats:copy(AXES,o.stats),tokens:copy(TOKENS,o.tokens),owned:o.owned.map(card).sort((a,b)=>Number(a.cardNo)-Number(b.cardNo)||(a.effect||'').localeCompare(b.effect||'')),candidates:o.candidates.map(card),pickCount:o.pickCount,allowSkip:o.allowSkip,turns:o.turns.map(t=>({recommended:t.recommended,recommendedStatus:t.recommendedStatus,training:t.training,deletion:t.deletion})),offerHistory:[],refreshRemaining:0};
}
export function extractFreshAhiruRows(record,{gameId}){
    const m=record.metadata,score=record.result?.score;
    if(m?.difficulty!=='fresh'||m.source!=='autoplay'||m.calcMode||m.eventId||m.reroll||m.research||m.forcedChoice||record.truncated||!gameId||!Number.isFinite(score?.displayScore)||AXES.some(axis=>!Number.isFinite(score[axis])))throw Error('リセマラなし通常FRESHの全完走が必要');
    if(record.events.some((event,index)=>event.sequence!==index||!Number.isInteger(event.turn)||event.turn<0||event.turn>7))throw Error('イベント順・ターンの不一致');
    const catalog=new Map(m.catalog.map(c=>[String(c.cardNo),c])),owned=new Map(),publicRows=[],labels=[];
    let stats=null,tokens=null,turns=null,ordinal=0;
    const add=(phase,observation,action,extra={})=>{const rowId=`${gameId}-decision-${ordinal++}`;publicRows.push({rowId,gameId,phase,...extra,observation});labels.push({rowId,gameId,action});};
    for(let turn=0;turn<8;turn++){
        const events=record.events.filter(event=>event.turn===turn),pending=[];
        let draws=0,decisions=0;
        for(const event of events.filter(event=>event.type!=='delete')){
            if(event.type==='acquire'){
                const no=String(event.card.cardNo),definition=catalog.get(no),id=event.card.instanceId;
                if(!definition||!id||owned.has(id)||event.card.rarity!=='N'&&pending.shift()!==no)throw Error('実取得と取得判断・所有札が不一致');
                owned.set(id,{...card(definition),acquiredTurn:event.card.acquiredTurn||0});
            }else if(event.type==='acquisition-decision'){
                if(draws||pending.length)throw Error('取得前後の順序が不正');
                const o=publicObservation(event.observation),indices=event.chosenIndices;
                if(o.turn!==turn||!same(multiset(o.owned),multiset([...owned.values()]))||stats&&!same(o.stats,stats)||tokens&&!same(o.tokens,tokens))throw Error('取得時の所有札・パラメータ・トークンが過去の記録と不一致');
                if(![1,2].includes(o.pickCount)||!Array.isArray(indices)||new Set(indices).size!==indices.length||indices.some(i=>!Number.isInteger(i)||!o.candidates[i])||!(indices.length===o.pickCount||o.allowSkip&&indices.length===0))throw Error('実取得の枚数・番号が不正');
                stats={...o.stats};tokens={...o.tokens};turns=o.turns;decisions++;
                pending.push(...indices.map(i=>String(o.candidates[i].cardNo)));
                add('acquisition',o,{indices:[...indices],cardNos:[...pending],skipped:indices.length===0});
                if(o.allowSkip){if(tokens.inspiration<1)throw Error('発想がない追加取得');tokens.inspiration--;}
            }else if(event.type==='draw'){
                if(++draws!==1||!decisions||pending.length||event.requested!==Math.max(0,4+tokens.passion-tokens.fatigue))throw Error('全8ドローと取得・消費トークンが不一致');
                tokens.passion=0;tokens.fatigue=0;
            }else if(event.type==='resolve'){
                if(!draws||!same(copy(AXES,event.beforeStats),stats)||!same(copy(TOKENS,event.beforeTokens),tokens))throw Error('解決前の公開パラメータ・トークンが不一致');
                stats=copy(AXES,event.afterStats);tokens=copy(TOKENS,event.afterTokens);
            }
        }
        if(draws!==1||pending.length)throw Error('全8ターンを完走していない');
        const deleted=events.filter(event=>event.type==='delete'),deleteMax=(turns[turn].deletion||0)+tokens.organize;
        if(deleted.length>deleteMax)throw Error('実削除が合法な枚数を超える');
        if(deleteMax>0&&turn<7){
            const o=publicObservation({difficulty:'fresh',mode:'normal',turn,totalTurns:8,stats,tokens,owned:[...owned.values()],candidates:[],pickCount:0,allowSkip:false,turns});
            add('deletion',o,{cardNos:deleted.map(event=>String(event.card.cardNo)),deleteMax},{deleteMax});
        }
        for(const event of deleted){const found=owned.get(event.card.instanceId);if(!found||String(found.cardNo)!==String(event.card.cardNo))throw Error('所有していない実カードの削除');owned.delete(event.card.instanceId);}
        tokens.organize=0;
    }
    if(!same(stats,copy(AXES,score))||!same(multiset([...owned.values()]),multiset(record.result.finalDeck)))throw Error('最終値・最終デッキと実記録が不一致');
    return {publicRows,labels,outcome:{gameId,score:score.displayScore,basePoints:score.points,grade:score.rank?.grade,stats:copy(AXES,score),withdrawal:score.withdrawal,enrollmentDiff:score.enrollmentDiff},weightPerDecision:1/publicRows.length};
}
async function main(){
    const [inputFile,output]=process.argv.slice(2);if(!inputFile||!output)throw Error('FRESH完走記録と出力ディレクトリが必要');
    const bytes=await readFile(inputFile),data=JSON.parse(bytes),settings=data.settings,records=data.simulations?.[0]?.playRecords;
    if(settings.difficulty!=='fresh'||settings.initialObservation||settings.forcedChoice||settings.episodeOffset!==0||settings.acquisitionModel!=='reach'||data.simulations?.length!==1||records?.length!==settings.episodes||records.length<250)throw Error('固定したFRESH・reachの250開始以上が必要');
    const first=records[0].metadata,publicRows=[],labels=[],outcomes=[],seeds=[],seen=new Set();
    for(let i=0;i<records.length;i++){
        const record=records[i],m=record.metadata,sourceSeed=`${settings.seed}:${i}`;
        if(m.seed!==sourceSeed||seen.has(sourceSeed)||!same(m.provenance,first.provenance)||m.cardVersion!==first.cardVersion||m.rankVersion!==first.rankVersion||!same(m.catalog,first.catalog)||m.acquisitionModel!=='reach'||m.continuationPolicy!==first.continuationPolicy)throw Error('全開始・固定方略/版の不一致');
        seen.add(sourceSeed);const gameId=`game-${i}`,rows=extractFreshAhiruRows(record,{gameId});publicRows.push(...rows.publicRows);labels.push(...rows.labels);outcomes.push(rows.outcome);seeds.push({gameId,sourceSeed,weightPerDecision:rows.weightPerDecision});
    }
    const publicInput={schema:'ahiru-public-decisions-v1',purpose:'FRESH判断時の公開情報だけ。実seed・行動・結果は含めない。',rows:publicRows};
    const teachers={schema:'ahiru-decision-teachers-v1',purpose:'過去の行動と公式結果。新規判断へ渡さない。',labels,outcomes,roots:seeds.map(({sourceSeed,...rest})=>rest)};
    await mkdir(output,{recursive:true});
    for(const [name,value]of [['public-decisions.json',publicInput],['teachers.json',teachers],['source-seeds.private.json',seeds]])await writeFile(path.join(output,name),JSON.stringify(value)+'\n');
    const counts={games:records.length,decisions:publicRows.length,acquisition:publicRows.filter(row=>row.phase==='acquisition').length,deletion:publicRows.filter(row=>row.phase==='deletion').length};
    const audit={createdAt:new Date().toISOString(),purpose:'FRESH過去完走からの観測診断材料。PROの2000開始の達成とは別。',diagnostic:true,counts,sourceFile:inputFile,sourceSha256:sha(bytes),sourceActor:first.provenance.strategyVersion,physical:{cardVersion:first.cardVersion,rankVersion:first.rankVersion,codeHash:first.provenance.codeHash},config:settings,allStartsAccepted:true,rerolls:0,sourceSeedsUnique:true,publicInputSha256:sha(await readFile(path.join(output,'public-decisions.json'))),teachersSha256:sha(await readFile(path.join(output,'teachers.json'))),generatorSha256:sha(await readFile('solver/ahiru-fresh-dataset.mjs'))};
    await writeFile(path.join(output,'audit.json'),JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify(counts));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error);process.exitCode=1;});

import {CardManager} from '../../game/js/cardManager.js';
import {projectProDeck} from '../../game/js/proAcquisitionAdvisor.js';
import {RESEARCH_MODES} from './pro-strategy-research.js';
import {createIntrinsicRecoveryCheck} from './pro-intrinsic-recovery.js';

const AXES={accounting:'庶務',satisfaction:'応対'};
const FLAGS=['removedLastRecovery','removedLastRecoveryWhileBelow15','removedLastRecoveryWithFutureShortage','removedLastRecoveryAtLeast15WithFutureShortage','removedLastCategoryWithoutRecovery'];
/** 実削除を追跡する記述診断。別の削除による将来成績は推定しない。 */
export function countDeletionRoles({publicInput,teachers,rankTable},{forecastDeck,canRecover}){
    const outcomes=new Map(teachers.outcomes.map(o=>[o.gameId,o]));
    if(outcomes.size!==teachers.outcomes.length||outcomes.size<250)throw Error('異なる250開始以上の全結果が必要');
    const labels=new Map(teachers.labels.map(l=>[l.rowId,l]));
    if(labels.size!==teachers.labels.length)throw Error('判断の教師が重複');
    const flags=new Map([...outcomes.keys()].map(id=>[id,Object.fromEntries(Object.keys(AXES).map(axis=>[axis,new Set()]))]));
    const seen=new Set(),withDeletion=new Set();let decisions=0,removedCards=0;
    const examples=[];
    for(const row of publicInput.rows){
        if(row.phase!=='deletion')continue;
        const o=row.observation,label=labels.get(row.rowId);
        if(!outcomes.has(row.gameId)||seen.has(row.rowId)||label?.gameId!==row.gameId||!Array.isArray(label.action?.cardNos)||o.difficulty!=='pro'||o.mode!=='normal'||!Number.isInteger(o.turn)||o.turn<0||o.turn>7)throw Error('通常PROの削除と公開判断・結果の対応が必要');
        seen.add(row.rowId);decisions++;
        let owned=[...o.owned];
        if(label.action.cardNos.length)withDeletion.add(row.gameId);
        if(o.turn===7&&label.action.cardNos.length)throw Error('最終会議後の削除は許可されない');
        const next={...o,rankTable,turn:o.turn+1,tokens:{...o.tokens,inspiration:0,organize:0}};
        for(const no of label.action.cardNos){
            const index=owned.findIndex(c=>String(c.cardNo)===String(no));
            if(index<0)throw Error('実削除のカードが公開デッキにない');
            const card=owned[index],after=[...owned];after.splice(index,1);
            const forecast=forecastDeck({...next,owned:after},after);
            for(const [axis,category] of Object.entries(AXES)){
                if(!Number.isFinite(o.stats[axis])||!Number.isFinite(forecast[axis]))throw Error('数値が有限ではない');
                const gameFlags=flags.get(row.gameId)[axis];
                const recovery=canRecover(card,axis,next,15,forecast);
                const removedLast=recovery&&!after.some(c=>canRecover(c,axis,next,15,forecast));
                const categoryLost=card.category===category&&!after.some(c=>c.category===category);
                if(categoryLost&&!recovery)gameFlags.add('removedLastCategoryWithoutRecovery');
                if(removedLast){
                    gameFlags.add('removedLastRecovery');
                    if(o.stats[axis]<15)gameFlags.add('removedLastRecoveryWhileBelow15');
                    if(forecast[axis]<15){
                        gameFlags.add('removedLastRecoveryWithFutureShortage');
                        if(o.stats[axis]>=15){
                            gameFlags.add('removedLastRecoveryAtLeast15WithFutureShortage');
                            if(examples.length<12)examples.push({gameId:row.gameId,rowId:row.rowId,turn:o.turn,axis,cardNo:no,current:o.stats[axis],projectedWithoutCard:forecast[axis],actualFinal:outcomes.get(row.gameId).stats[axis],actualScore:outcomes.get(row.gameId).score});
                        }
                    }
                }
            }
            owned=after;removedCards++;
        }
    }
    const counts=Object.fromEntries(Object.keys(AXES).map(axis=>[axis,Object.fromEntries(FLAGS.map(flag=>{
        const ids=[...flags].filter(([,f])=>f[axis].has(flag)).map(([id])=>id);
        return [flag,{games:ids.length,endedAtMost8:ids.filter(id=>outcomes.get(id).score<=8).length}];
    }))]));
    return {games:outcomes.size,decisions,removedCards,gamesWithActualDeletion:withDeletion.size,allEndedAtMost8:[...outcomes.values()].filter(o=>o.score<=8).length,counts,examples,interpretation:'全開始を分母とした元ゲームの重複なし件数のみ。同じゲームの複数削除を別の開始と数えない。回復判定と固定投影は当時の公開状態・既知の日程だけを使う。将来の実手札、乱数、結果は判定へ渡さない。最後の回復札を残す介入の救済数・効果ではなく、次の仮説の対象件数。250未満の下位群から条件付き成功率は推定しない。'};
}

export async function diagnoseDeletionRoles(input){
    const parser=new CardManager(null);await parser.loadCards('/game/data/cards_pro.csv');
    if(parser.dataVersion!==input.versions.cardVersion)throw Error('公開カードの版が一致しない');
    const original=parser.parseEffect.bind(parser),cache=new Map();
    parser.parseEffect=text=>{if(!cache.has(text))cache.set(text,original(text));return cache.get(text);};
    return countDeletionRoles(input,{canRecover:createIntrinsicRecoveryCheck(parser),forecastDeck:(o,cards)=>{
        const first=projectProDeck(o,{weights:RESEARCH_MODES.engine,cards});
        const second=projectProDeck(o,{weights:RESEARCH_MODES.engine,cards,forecast:first.end});
        return {...second.end,enrollment:Math.min(second.end.enrollment,second.end.experience)};
    }});
}

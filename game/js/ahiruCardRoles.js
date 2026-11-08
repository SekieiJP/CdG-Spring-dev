import {CardManager} from './cardManager.js?v=20261107-0064';
/** カテゴリ名ではなく、条件・コストを満たして実際に増やせる効果を調べる。 */
const parser=new CardManager(null),parsed=new Map(),SLOTS=['leader','teacher','staff'],AXES=['experience','enrollment','satisfaction','accounting'];
function effect(card){const text=card.effect||'';if(!parsed.has(text)){if(parsed.size>512)parsed.clear();parsed.set(text,parser.parseEffect(text));}return parsed.get(text);}
export function createAhiruRoleInspector(observation,forecast){
    const memo=new Map();
    function contexts(card){
        const p=effect(card),slots=p.staffRestrictions.length?p.staffRestrictions:SLOTS,rows=[];
        for(let turn=observation.turn;turn<observation.totalTurns;turn++)for(const source of [observation.stats,forecast])for(const slot of slots){
            const stats=Object.fromEntries(AXES.map(k=>[k,source[k]])),state={difficulty:observation.difficulty,turn,totalTurns:observation.totalTurns,player:stats,tokens:{...observation.tokens}};
            const schedule=observation.turns?.[turn],recommended=schedule?.recommended===card.category?schedule.recommendedStatus:null;
            const out=parser.simulateCardEffect(card,slot,stats,recommended,state);
            if(out.applied)rows.push({turn,stats,out,effects:[...(recommended?[{type:'change',status:recommended,value:1}]:[]),...parser.getApplicableEffects(p,slot,stats,state)]});
        }
        return rows;
    }
    function rows(card){const key=card.cardNo+'|'+card.effect;if(!memo.has(key))memo.set(key,contexts(card));return memo.get(key);}
    return {
        canRecover(card,axis,target){
            if(!AXES.includes(axis)||!Number.isFinite(target))throw Error('回復目標が不正');
            return rows(card).some(r=>{
                if(r.out.afterStats[axis]<=r.stats[axis])return false;
                const relevant=r.effects.filter(e=>e.status===axis&&['change','set'].includes(e.type)),last=relevant.at(-1);
                if(last?.type==='set'&&last.value<target)return false;
                return relevant.some(e=>e.type==='change'&&e.value>0||e.type==='set'&&e.value>=target);
            });
        },
        supportsHand(card){
            return rows(card).some(r=>{
                let net=0;for(const e of r.effects)if(e.type==='token'&&r.turn+1<observation.totalTurns)net+=e.token==='passion'?1:e.token==='fatigue'?-1:e.token==='inspiration'?.5:0;
                return net>0||r.effects.some(e=>e.type==='immediate'&&e.effect==='parallel');
            });
        }
    };
}

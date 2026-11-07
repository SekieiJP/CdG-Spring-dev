import {CardManager} from './cardManager.js?v=20260815-0059';
import {createAhiruRoleInspector} from './ahiruCardRoles.js?v=20260815-0059';

const parser=new CardManager(null);
const LABELS={experience:'体験',enrollment:'入塾',satisfaction:'満足',accounting:'経理'};
const AXES=Object.keys(LABELS),SLOTS=['leader','teacher','staff'],EPSILON=1e-8;
const parsedCache=new Map();
function parsed(card){
    const effect=card.effect||'';
    if(!parsedCache.has(effect)){
        if(parsedCache.size>256)parsedCache.clear();
        parsedCache.set(effect,parser.parseEffect(effect));
    }
    return parsedCache.get(effect);
}
const answer=(reason,text)=>({reason,text:'🐤'+text});
const empty=()=>({reason:null,text:''});

/** 条件・コスト・効果の順序は本体の適用器を使う。将来のゲーム試行は行わない。 */
function inspectCard(card,observation,stats=observation.stats){
    const definition=parsed(card),slots=definition.staffRestrictions.length?definition.staffRestrictions:SLOTS;
    const schedule=observation.turns?.[observation.turn],recommended=schedule?.recommended===card.category?schedule.recommendedStatus:null;
    const state={difficulty:observation.difficulty,turn:observation.turn,totalTurns:observation.totalTurns,player:stats,tokens:observation.tokens};
    const rows=slots.map(slot=>{
        const effects=[...(recommended?[{type:'change',status:recommended,value:1}]:[]),...parser.getApplicableEffects(definition,slot,stats,state)];
        const outcome=parser.simulateCardEffect(card,slot,stats,recommended,state);
        const delta=Object.fromEntries(AXES.map(axis=>[axis,outcome.afterStats[axis]-stats[axis]]));
        const tokens=token=>effects.filter(effect=>effect.type==='token'&&effect.token===token).length;
        return {slot,effects,outcome,delta,passion:tokens('passion')-tokens('fatigue'),fatigue:tokens('fatigue')-tokens('passion'),
            parallel:effects.some(effect=>effect.type==='immediate'&&effect.effect==='parallel')};
    });
    const applied=rows.filter(row=>row.outcome.applied);
    const remaining=observation.totalTurns-observation.turn;
    const productive=row=>AXES.some(axis=>row.delta[axis]>EPSILON)||remaining>1&&(row.passion>0||row.effects.some(e=>e.type==='token'&&['inspiration','organize'].includes(e.token)));
    return {definition,rows,applied,productive};
}

function enrollmentNeedsExperience(details,stats){
    return details.applied.some(row=>{
        const positive=row.effects.reduce((sum,e)=>sum+(e.type==='change'&&e.status==='enrollment'&&e.value>0?e.value:0),0);
        return positive>EPSILON&&row.delta.enrollment<positive-EPSILON&&stats.enrollment+positive>stats.experience;
    });
}
function missingCondition(details,observation){
    return details.definition.conditionalBlocks.find(block=>{
        const condition=block.condition;
        if(!['status','remainingTurns'].includes(condition.type))return false;
        const beneficial=block.effects.some(e=>e.type==='change'&&e.value>0||e.type==='set'&&e.value>observation.stats[e.status]||e.type==='token'&&e.token!=='fatigue'&&observation.totalTurns-observation.turn>1);
        return beneficial&&!details.rows.some(row=>parser.evaluateCondition(condition,row.slot,{player:observation.stats,turn:observation.turn,totalTurns:observation.totalTurns}));
    })?.condition;
}

/** 非推奨でも取得を否定せず、現在の状態で注意が要る点だけを一つ返す。 */
function caution(details,observation){
    for(const axis of ['accounting','satisfaction','experience','enrollment']){
        const costs=details.rows.flatMap(row=>row.effects.filter(e=>e.type==='change'&&e.status===axis&&e.value<0));
        if(!costs.length)continue;
        const shortage=details.rows.flatMap(row=>row.outcome.shortageEffects||[]).find(e=>e.status===axis);
        if(shortage&&!details.applied.length)return answer('cost-preparation',`使う前に${LABELS[axis]}を増やしておこう`);
        const all=details.rows.every(row=>row.effects.some(e=>e.type==='change'&&e.status===axis&&e.value<0));
        return answer('cost',`${all?'':'配置先によって'}${LABELS[axis]}を消費するので注意`);
    }
    for(const row of details.applied){
        const lowered=row.effects.find(e=>e.type==='set'&&e.value<observation.stats[e.status]&&row.delta[e.status]<0);
        if(lowered)return answer('lower-set',`${LABELS[lowered.status]}が${lowered.value}になるので、使う順番に注意`);
    }
    if(observation.totalTurns-observation.turn>1&&details.applied.some(row=>row.fatigue>0))return answer('fatigue','次のターンの手札が減るので注意');
    if(enrollmentNeedsExperience(details,observation.stats))return answer('experience-preparation','他のカードで体験を増やしてから使おう');
    const condition=missingCondition(details,observation);
    if(condition?.type==='status'){
        const label=LABELS[condition.status],direction=condition.comparison==='gte'?'以上':'以下';
        return answer('condition-preparation',`いまは${label}${condition.value}${direction}の条件を満たしていないよ`);
    }
    if(condition?.type==='remainingTurns')return answer('late-condition','残りターンでは条件の効果を使えないので注意');
    return empty();
}

function enablesOwnedCondition(details,observation){
    for(const owned of observation.owned){
        const definition=parsed(owned),slots=definition.staffRestrictions.length?definition.staffRestrictions:SLOTS;
        for(const block of definition.conditionalBlocks){
            const condition=block.condition;
            if(condition.type!=='status'||condition.comparison!=='gte'||observation.stats[condition.status]>=condition.value)continue;
            if(!block.effects.some(e=>e.type==='change'&&e.value>0||e.type==='token'&&e.token!=='fatigue'&&observation.totalTurns-observation.turn>1))continue;
            const enabled=details.applied.some(row=>{
                const stats=row.outcome.afterStats;
                if(stats[condition.status]<condition.value)return false;
                const state={difficulty:observation.difficulty,turn:observation.turn,totalTurns:observation.totalTurns,player:stats};
                return slots.some(slot=>{
                    if(observation.totalTurns-observation.turn===1&&(SLOTS.indexOf(slot)<SLOTS.indexOf(row.slot)||slot===row.slot&&!row.parallel&&!definition.baseEffects.some(e=>e.type==='immediate'&&e.effect==='parallel')))return false;
                    const out=parser.simulateCardEffect(owned,slot,stats,null,state);
                    return parser.evaluateCondition(condition,slot,state)&&out.applied&&(AXES.some(axis=>out.afterStats[axis]>stats[axis])||observation.totalTurns-observation.turn>1&&block.effects.some(e=>e.type==='token'&&e.token!=='fatigue'));
                });
            });
            if(enabled)return condition.status;
        }
    }
    return null;
}

function recommendation(card,index,details,scene,roles,ownedRoles){
    const {observation,advice,status}=scene,remaining=observation.totalTurns-observation.turn;
    const focus=status?.focusAxis,canHelp=axis=>axis&&roles.canRecover(card,axis,15);
    const shortage=['shortage','initial-experience-foundation','current-s-protect'].includes(status?.outlookReason);
    if(observation.turn===0&&focus==='experience'&&details.applied.some(row=>row.delta.experience>0))return answer('opening-foundation','序盤の体験づくりを助けてくれそうだ');
    const enabledAxis=enablesOwnedCondition(details,observation);
    if(enabledAxis)return answer('owned-condition',`${LABELS[enabledAxis]}が条件の所持カードと相性がいいね`);
    const condition=missingCondition(details,observation),raw=status?.forecast?.rawEnd;
    if(remaining>1&&condition?.type==='status'&&condition.comparison==='gte'&&raw?.[condition.status]>=condition.value&&observation.owned.some(owned=>ownedRoles.canRecover(owned,condition.status,condition.value)))return answer('owned-preparation',`所持カードで${LABELS[condition.status]}を増やすと活かせそうだ`);
    if(shortage&&canHelp(focus))return answer('missing-role',`いまのデッキで不足しそうな${LABELS[focus]}を補えそうだ`);
    if(enrollmentNeedsExperience(details,observation.stats)){
        if(observation.owned.some(owned=>ownedRoles.canRecover(owned,'experience',1)))return answer('owned-experience','体験を増やす所持カードと組み合わせられそうだ');
        const companion=advice.recommended.indices.some(i=>i!==index&&roles.canRecover(observation.candidates[i],'experience',1));
        if(companion)return answer('pair-experience','一緒に選ぶ体験のカードと組み合わせられそうだ');
        return answer('experience-preparation','体験を増やす準備ができると活かせそうだ');
    }
    if(canHelp('experience')&&observation.stats.enrollment>=observation.stats.experience&&observation.owned.some(owned=>ownedRoles.canRecover(owned,'enrollment',1)))return answer('owned-enrollment','所持カードの入塾効果を活かしやすくなるね');
    const draw=Math.max(0,4+(observation.tokens?.passion||0)-(observation.tokens?.fatigue||0));
    if(remaining>1&&observation.owned.length>draw&&details.applied.some(row=>row.passion>0))return answer('hand-pressure','引きたい所持カードが多い今と相性がいいね');
    const normal=observation.owned.filter(owned=>!parsed(owned).baseEffects.some(e=>e.type==='immediate'&&e.effect==='parallel'));
    if(normal.length>=3&&draw>=4&&details.applied.some(row=>row.parallel&&details.productive(row)))return answer('placement-pressure','配置先が混み合う今のデッキと相性がいいね');
    if(shortage&&focus&&status.actionAxis&&status.actionAxis!==focus&&canHelp(status.actionAxis))return answer('alternative-role',`今回は${LABELS[status.actionAxis]}を補う選び方もアリ`);
    const expectedUses=remaining*Math.min(1,draw/Math.max(1,observation.owned.length+observation.pickCount))*.7;
    if(remaining>=5&&expectedUses>=2&&details.applied.some(details.productive))return answer('long-use','序盤から使えて、長く働いてくれそうだ');
    const selected=advice.recommended,features=selected.features||{};
    const scoreGain=(features.points||0)>EPSILON||(features.threshold||0)>EPSILON||(features.precision||0)>EPSILON;
    if(scoreGain&&details.applied.some(details.productive))return answer('remaining-score',remaining===1?'最後のターンの得点の上積みを狙えそうだ':`残り${remaining}ターンで得点を伸ばす役になりそうだ`);
    if(selected.score<=0)return answer('least-burden','今回はデッキへの負担を抑える選び方だよ');
    // 説明の根拠がなければ、能力の言い換えや順位の断言で埋めない。
    return empty();
}

/** 提示時の公開スナップショットだけから短い説明を作り、選択操作では更新しない。 */
export function explainAcquisitionCandidates(scene){
    const {observation,advice,status}=scene;
    if(!observation?.candidates?.length||!advice?.recommended)return [];
    const raw=status?.forecast?.rawEnd||observation.stats;
    const roles=createAhiruRoleInspector(observation,advice.recommended.forecast||raw);
    const ownedRoles=createAhiruRoleInspector(observation,raw),recommended=new Set(advice.recommended.indices||[]);
    return observation.candidates.map((card,index)=>{
        const details=inspectCard(card,observation);
        return recommended.has(index)?recommendation(card,index,details,scene,roles,ownedRoles):caution(details,observation);
    });
}

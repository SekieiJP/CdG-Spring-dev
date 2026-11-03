import {projectProAdviceState} from '../../game/js/ahiruProForecast.js';
import {projectFreshAdviceState} from '../../game/js/ahiruFreshForecast.js';
const AXES=['experience','enrollment','satisfaction','accounting'];
/** 過去の全開始から時期別の補正をブラウザ内で作る。新しい判断へ教師は渡さない。 */
export function fitAhiruCalibration({difficulty,publicInput,teachers,rankTable}){
    const project=difficulty==='fresh'?projectFreshAdviceState:projectProAdviceState;
    const outcomes=new Map(teachers.outcomes.map(row=>[row.gameId,row])),labels=new Map(teachers.labels.map(row=>[row.rowId,row]));
    if(outcomes.size<250)throw Error('250元開始以上が必要');
    const groups=new Map(),seen=new Set();
    for(const row of publicInput.rows){
        const original=row.observation;
        if(original.difficulty!==difficulty)throw Error('難易度が混在');
        if(row.phase==='acquisition'&&original.allowSkip)continue;
        const unique=[row.gameId,row.phase,original.turn].join(':');if(seen.has(unique))throw Error('同一時期・元開始の重複');seen.add(unique);
        const label=labels.get(row.rowId),actual=outcomes.get(row.gameId);if(!label||!actual)throw Error('公開入力と教師の対応がない');
        const input={...original,rankTable};
        for(const name of ['seed','rng','deckOrder','outcome'])Object.defineProperty(input,name,{get(){throw Error('非公開情報への参照');}});
        let chosen;
        if(row.phase==='acquisition')chosen=[...label.action.indices];
        else {const used=new Set();chosen=label.action.cardNos.map(no=>{const index=input.owned.findIndex((card,i)=>!used.has(i)&&String(card.cardNo)===String(no));if(index<0)throw Error('削除が所有札と一致しない');used.add(index);return index;});}
        for(const [position,selectedIndices]of [['before',[]],['after',chosen]]){
            if(position==='after'&&row.phase==='deletion'&&!chosen.length)continue;
            const before=JSON.stringify(input),f=project(input,{phase:row.phase,selectedIndices,deleteMax:row.deleteMax||0});
            if(JSON.stringify(input)!==before)throw Error('投影が公開入力を変更');
            const key=[row.phase,position,original.turn].join(':');if(!groups.has(key))groups.set(key,[]);
            groups.get(key).push({gameId:row.gameId,owned:f.observation.owned.length,residual:AXES.map(axis=>actual.stats[axis]-f.rawEnd[axis])});
        }
    }
    const phases=Object.fromEntries(['acquisition','deletion'].map(phase=>[phase,{before:Array(8).fill(null),after:Array(8).fill(null)}])),support={};
    const q=(values,p)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)];
    for(const [key,rows]of groups){
        const [phase,position,turn]=key.split(':'),games=new Set(rows.map(row=>row.gameId)).size;
        support[key]={games,states:rows.length,support250:games>=250};if(games<250)continue;
        if(games!==rows.length)throw Error('同一群で元開始が重複');
        phases[phase][position][Number(turn)]={games,ownedMin:Math.min(...rows.map(row=>row.owned)),ownedMax:Math.max(...rows.map(row=>row.owned)),median:AXES.map((_,i)=>q(rows.map(row=>row.residual[i]),.5)),lower:AXES.map((_,i)=>q(rows.map(row=>row.residual[i]),.1)),upper:AXES.map((_,i)=>q(rows.map(row=>row.residual[i]),.9))};
    }
    return {sourceGames:outcomes.size,phases,support,featuresAndFittingInBrowser:true};
}

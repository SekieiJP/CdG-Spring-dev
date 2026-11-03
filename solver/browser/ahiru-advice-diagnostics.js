import {recommendProStatus} from '../../game/js/ahiruProAdvice.js';
import {proGoal} from '../../game/js/proAcquisitionAdvisor.js';
import {getProSGoals} from '../../game/js/ahiruProGoals.js';
import {recommendFreshStatus} from '../../game/js/ahiruFreshAdvice.js';
import {getFreshSGoals,scoreFreshStats} from '../../game/js/ahiruFreshGoals.js';

const AXES=['experience','enrollment','satisfaction','accounting'];

/** 過去の教師は集計にだけ使う。助言へ渡すのは各時点の公開入力だけ。 */
export function diagnoseAhiruAdvice({difficulty='pro',publicInput,teachers,calibration,rankTable,versions}) {
    const outcomes=new Map(teachers.outcomes.map(row=>[row.gameId,row]));
    const labels=new Map(teachers.labels.map(row=>[row.rowId,row]));
    const target=(difficulty==='fresh'?getFreshSGoals:getProSGoals)(rankTable).targetPoints;
    const recommend=difficulty==='fresh'?recommendFreshStatus:recommendProStatus;
    const points=stats=>difficulty==='fresh'?scoreFreshStats(stats).displayScore:proGoal(stats,rankTable).points;
    const groups=new Map();
    const seenMain=new Set();
    let calls=0;
    function predict(observation,options){
        for(const name of ['seed','rng','deckOrder','outcome'])Object.defineProperty(observation,name,{configurable:true,get(){throw Error('助言が非公開情報を参照した');}});
        const before=JSON.stringify(observation);
        // 禁止フィールドは非列挙。教師・実seedはこの呼び出しの引数に含めない。
        const advice=recommend(observation,{...options,calibration,versions});
        if(JSON.stringify(observation)!==before||!advice||Array.from(advice.text).length>25)throw Error('助言の不変性・文字数・返却値の不一致');
        calls++;
        return advice;
    }
    for(const row of publicInput.rows){
        const label=labels.get(row.rowId),actual=outcomes.get(row.gameId);
        if(!label||!actual)throw Error('判断と教師の対応がない');
        const observation={...row.observation,rankTable};
        const kind=row.phase==='acquisition'?(observation.allowSkip?'inspiration':'acquisition'):'deletion';
        if(kind!=='inspiration'){
            const key=[row.gameId,kind,observation.turn].join(':');
            if(seenMain.has(key))throw Error('同一元ゲーム・時期の判断が重複');
            seenMain.add(key);
        }
        let chosen;
        if(row.phase==='acquisition')chosen=[...label.action.indices];
        else {
            const removed=new Set();
            chosen=label.action.cardNos.map(no=>{
                const index=observation.owned.findIndex((card,i)=>!removed.has(i)&&String(card.cardNo)===String(no));
                if(index<0)throw Error('実削除と公開デッキが不一致');
                removed.add(index);
                return index;
            });
        }
        for(const [position,selectedIndices] of [['before',[]],['after',chosen]]){
            const advice=predict(observation,{phase:row.phase,selectedIndices,deleteMax:row.deleteMax||0});
            const f=advice.forecast;
            const key=[kind,observation.turn,position].join(':');
            if(!groups.has(key))groups.set(key,[]);
            groups.get(key).push({gameId:row.gameId,actual,advice,raw:points(f.rawEnd),corrected:points(f.expectedEnd)});
        }
    }
    const result={};
    for(const [key,rows] of groups){
        const counts=new Map();
        for(const row of rows)counts.set(row.gameId,(counts.get(row.gameId)||0)+1);
        const games=counts.size;
        if(games<250){result[key]={games,states:rows.length,support250:false};continue;}
        const average=fn=>rows.reduce((sum,row)=>sum+fn(row)/counts.get(row.gameId),0)/games;
        const projection=field=>({
            meanPoints:average(row=>row[field]),
            pointsMAE:average(row=>Math.abs(row[field]-row.actual.score)),
            predictedSRate:average(row=>Number(row[field]>=target)),
            projectedSButActualBelowRate:average(row=>Number(row[field]>=target&&row.actual.score<target)),
            projectedBelowButActualSRate:average(row=>Number(row[field]<target&&row.actual.score>=target)),
            axes:Object.fromEntries(AXES.map(axis=>[axis,{
                mae:average(row=>Math.abs(row.advice.forecast[field==='raw'?'rawEnd':'expectedEnd'][axis]-row.actual.stats[axis])),
                bias:average(row=>row.advice.forecast[field==='raw'?'rawEnd':'expectedEnd'][axis]-row.actual.stats[axis])
            }]))
        });
        result[key]={
            games,states:rows.length,support250:true,weighting:'同じ元ゲーム・時期内の総重みを1にする',
            calibrationUsedRate:average(row=>Number(row.advice.forecast.calibrated)),
            actualMeanPoints:average(row=>row.actual.score),actualSRate:average(row=>Number(row.actual.score>=target)),
            raw:projection('raw'),corrected:projection('corrected'),
            tones:Object.fromEntries(['red','yellow','green'].map(tone=>[tone,average(row=>Number(row.advice.tone===tone))])),
            greenButActualBelowSRate:average(row=>Number(row.advice.tone==='green'&&row.actual.score<target)),
            axes:Object.fromEntries(AXES.map(axis=>[axis,{
                marginalIntervalCoverage:average(row=>Number(row.actual.stats[axis]>=row.advice.forecast.lowerEnd[axis]&&row.actual.stats[axis]<=row.advice.forecast.upperEnd[axis]))
            }]))
        };
    }
    let finalAgreements=0;
    for(const actual of outcomes.values()){
        const observation={difficulty,mode:'normal',turn:7,totalTurns:8,stats:{...actual.stats},tokens:{passion:0,fatigue:0,inspiration:0,organize:0},owned:[],candidates:[],pickCount:1,allowSkip:false,turns:Array(8).fill({}),rankTable};
        const advice=predict(observation,{phase:'deletion',deleteMax:0});
        if((advice.tone==='green')!==(actual.score>=target))throw Error('最終会議のS判定と公式結果が不一致');
        finalAgreements++;
    }
    return {games:outcomes.size,calls,groups:result,finalAgreements,allDecisionsIncluded:true,featuresAndStatisticsInBrowser:true};
}

export const diagnoseProAdvice=diagnoseAhiruAdvice;

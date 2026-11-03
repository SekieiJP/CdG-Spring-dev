/** 平均モデルの係数を変えず、種類の一致する危険予測を1つだけ付ける。 */
import {VALUE_SCHEMA,VALUE_FEATURES} from './browser/pro-value-model.js';
const KINDS={
    'pro-shortfall9':{field:'shortfallHead',meta:'shortfall',prediction:'max(0, fixed-tree prediction)'},
    'pro-failure8':{field:'failureHead',meta:'failure',prediction:'min(1, max(0, fixed-tree prediction))'}
};
export function attachRiskModel(mean,risk,kind){
    const spec=Object.hasOwn(KINDS,kind)?KINDS[kind]:null,valid=model=>model?.schema===VALUE_SCHEMA&&Array.isArray(model.features)&&model.features.join('|')===VALUE_FEATURES.join('|')&&Number.isFinite(model.base)&&Number.isFinite(model.learningRate)&&Array.isArray(model.trees),noHead=model=>!model?.shortfallHead&&!model?.failureHead;
    const counts=risk?.provenance?.counts,versions=mean?.provenance?.versions;
    const compatible=Array.isArray(versions)&&versions.length===4&&JSON.stringify(versions)===JSON.stringify(risk?.provenance?.versions);
    const sufficient=Number.isInteger(counts?.trainSeeds)&&counts.trainSeeds>=250&&Number.isInteger(counts?.validationSeeds)&&counts.validationSeeds>=250;
    if(!spec||!valid(mean?.model)||!valid(risk?.model)||!noHead(mean?.model)||!noHead(risk?.model)||risk.provenance?.targetKind!==kind||mean.provenance?.targetKind&&mean.provenance.targetKind!=='official-score'||!compatible||!sufficient)throw Error('互換な平均モデルと、別250開始以上で比較した種類の一致する危険モデルが必要');
    return {...mean,model:{...mean.model,[spec.field]:{...risk.model,targetKind:kind}},[spec.meta]:{id:risk.id,targetKind:kind,prediction:spec.prediction,provenance:risk.provenance}};
}

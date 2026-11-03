/** 過去の公式最終得点から作る危険の教師。学習・診断はブラウザ内で使う。 */
function check(kind,value){if(!['pro-shortfall9','pro-failure8'].includes(kind)||!Number.isFinite(value))throw Error('危険の種類と有限値が必要');}
export function encodeRiskTarget(score,kind){check(kind,score);return kind==='pro-failure8'?Number(score<=8):Math.max(0,9-score);}
export function clipRiskPrediction(value,kind){check(kind,value);return Math.min(kind==='pro-failure8'?1:Infinity,Math.max(0,value));}

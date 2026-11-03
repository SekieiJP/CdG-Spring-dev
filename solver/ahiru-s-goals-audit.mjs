#!/usr/bin/env node
/** 公式得点関数による基準例の確認。攻略の成功率の試験ではない。 */
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin=process.argv[2]||'http://127.0.0.1:19110',browser=await chromium.launch({headless:true});let checks;
try{
 const page=await browser.newPage();await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await page.goto(origin+'/index.html');await page.waitForFunction(()=>window.game?.cardManager?.allCards.length>0);
 checks=await page.evaluate(async()=>{
  const results=[];
  for(const difficulty of ['pro','fresh']){
   await window.game.setDifficulty(difficulty);const game=window.game;game.gameState.reset(difficulty,{seed:'ahiru-s-goals-audit'});
   const sRow=game.scoreManager.rankTable.find(r=>r.grade==='S'),thresholds={...sRow.thresholds};
   const samples=difficulty==='pro'?[
    {name:'four-S-thresholds',stats:{experience:40,enrollment:32,satisfaction:15,accounting:15},expectedScore:11},
    {name:'experience-50-route',stats:{experience:50,enrollment:32,satisfaction:15,accounting:15},expectedScore:12},
    {name:'enrollment-40-route',stats:{experience:40,enrollment:40,satisfaction:15,accounting:15},expectedScore:12},
    {name:'satisfaction-25-route',stats:{experience:40,enrollment:32,satisfaction:25,accounting:15},expectedScore:12},
   ]:[{name:'four-S-thresholds',stats:{experience:15,enrollment:12,satisfaction:15,accounting:15},expectedGrade:'S'}];
   for(const sample of samples){Object.assign(game.gameState.player,sample.stats);const score=game.scoreManager.calculateScore(game.gameState);
    if(sample.expectedScore!==undefined&&score.points!==sample.expectedScore||sample.expectedGrade&&score.rank.grade!==sample.expectedGrade)throw Error('公式基準と例の不一致');
    results.push({difficulty,name:sample.name,stats:sample.stats,sThresholds:thresholds,officialScore:score.points,displayScore:score.displayScore,grade:score.rank.grade,breakdown:score.breakdown});
   }
  }
  return results;
 });
}finally{await browser.close();}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={createdAt:new Date().toISOString(),purpose:'独立したブラウザページで公式ScoreManagerを呼び出した基準例。攻略の成功率・予測精度は示さない。',scoreManagerSha256:sha(await readFile('game/js/scoreManager.js')),proRankSha256:sha(await readFile('game/data/rankPro.csv')),freshRankSha256:sha(await readFile('game/data/rankFresh.csv')),checks};
await mkdir('solver/research-results/ahiru-advice-20261103',{recursive:true});await writeFile('solver/research-results/ahiru-advice-20261103/s-goals.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(checks,null,2));

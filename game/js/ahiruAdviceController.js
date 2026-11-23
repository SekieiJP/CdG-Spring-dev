import { createMasterAdvice } from './masterAdvice.js?v=20261122-0070';
import {loadAdviceCalibration} from './ahiruCalibrationLoader.js?v=20261122-0070';
import {AhiruAdviceView} from './ahiruAdviceView.js?v=20261122-0070';
import {createAdvisorObservation,recommendAcquisition} from './acquisitionAdvisor.js?v=20261122-0070';
import {alignAcquisitionWithStatus} from './proAcquisitionConsistency.js?v=20261122-0070';
import {recommendProStatus} from './ahiruProAdvice.js?v=20261122-0070';
import {recommendFreshStatus} from './ahiruFreshAdvice.js?v=20261122-0070';
import {chooseFreshForecastAcquisition} from './freshOutcomeForecast.js?v=20261122-0070';
import { estimateSOutlook, outlookObservation, withSOutlook } from './ahiruSOutlook.js?v=20261122-0070';
import { opponentSnapshot, snapshotCards } from './battleReplay.js?v=20261122-0070';
export const ADVICE_SCENE_VERSION=3;
const validStatus=status=>status&&['red','yellow','green'].includes(status.tone)&&typeof status.text==='string'&&status.text.trim()&&Array.from(status.text).length<=25;
/** 確定状態と提示候補のスナップショットを、助言・取得アシストで共有する。 */
export class AhiruAdviceController {
    constructor(ui,{calibrationTimeoutMs=3000}={}){this.calibrationTimeoutMs=calibrationTimeoutMs;this.ui=ui;this.phase=null;this.deleteMax=0;this.models=new Map();this.scheduled=false;this.disposed=false;}
    get modelStatus(){return this.models.get(this.ui.gameState.difficulty)?.status||'unloaded';}
    get calibration(){return this.models.get(this.ui.gameState.difficulty)?.calibration||null;}
    init(){
        const panel=document.getElementById('full-status-panel');if(!panel)return;
        this.view=new AhiruAdviceView(panel,{onToggle:()=>{
            if(this.phase==='action')this.ui.mobileLayout?.schedule();
        }});
        for(const difficulty of ['fresh','pro'])this.loadCalibration(difficulty);
        this.scheduleRefresh();
    }
    setPhase(phase){
        this.phase=phase;
        this.view?.setActionLayout(phase==='action');
        if(!this.eligible())this.view?.hide();else this.scheduleRefresh();
    }
    setDeleteMax(value){this.deleteMax=Math.max(0,Number(value)||0);this.scheduleRefresh();}
    scheduleRefresh(){
        if(!this.view||this.disposed||this.scheduled)return;this.scheduled=true;
        queueMicrotask(()=>{this.scheduled=false;this.refresh();});
    }
    eligible(){
        const state=this.ui.gameState,phase=this.phase||state.phase;
        if(state.difficulty==='int')return !state.calcMode&&!state.event?.enabled&&['training','meeting','outing','action'].includes(phase);
        return ['fresh','pro'].includes(state.difficulty)&&
            (['training','meeting'].includes(phase)||phase==='action'&&state.phase==='action');
    }
    getMasterScene(){
        const ui=this.ui,state=ui.gameState;
        if(!ui.scoreManager.rankTable?.length)return null;
        if(this.masterRun!==state.runId||this.masterCatalog!==ui.cardManager.allCards||this.masterRanks!==ui.scoreManager.rankTable){
            this.masterDecision=createMasterAdvice(ui);
            this.masterRun=state.runId;
            this.masterCatalog=ui.cardManager.allCards;
            this.masterRanks=ui.scoreManager.rankTable;
        }
        return this.masterDecision();
    }
    loadCalibration(difficulty=this.ui.gameState.difficulty){
        if(this.models.has(difficulty))return;
        const entry={status:'loading',calibration:null};this.models.set(difficulty,entry);
        const url=new URL(`../data/ahiru/${difficulty}-projection-calibration.json`,import.meta.url);url.search=new URL(import.meta.url).search;
        loadAdviceCalibration(url,{timeoutMs:this.calibrationTimeoutMs}).then(data=>{entry.calibration=data;entry.status='ready';}).catch(()=>{entry.status='failed';}).finally(()=>{
            // 到着済み補正は次の場面から使う。現在の文面・順位・5秒期限を差し替えない。
            this.scheduleRefresh();
        });
    }
    getSceneDecision(){
        if(this.ui.gameState.battle?.kind==='cpu')return null;
        if(this.disposed||!this.eligible())return null;
        const ui=this.ui,state=ui.gameState,phase=(this.phase||state.phase)==='meeting'?'deletion':'acquisition';
        if(state.playRecord!==this.runRecord){this.view?.reset();this.runRecord=state.playRecord;}
        if(state.difficulty==='int')return this.getMasterScene();
        if((this.phase||state.phase)==='action'){
            const key=JSON.stringify([state.runId,state.difficulty,state.turn]);
            if(this.actionScene?.key!==key){
                const observation=outlookObservation(state,ui.scoreManager.rankTable);
                const outlook=estimateSOutlook(observation,'action');
                this.actionScene={key,observation,status:withSOutlook(
                    {tone:'yellow',text:'発動条件と配置順を確認しよう'},outlook),acquisition:null};
            }
            return this.actionScene;
        }
        if(this.modelStatus==='unloaded')this.loadCalibration();
        const inspiration=ui.trainingSelectionMode==='inspiration',cards=phase==='acquisition'?(state.currentTrainingCards||[]):[];
        if(phase==='acquisition'&&!cards.length)return null;
        const observation=createAdvisorObservation(state,cards,{pickCount:state.turn===0&&!inspiration?2:1,allowSkip:inspiration,rankTable:ui.scoreManager.rankTable});
        const versions={cardVersion:ui.cardManager.dataVersion,rankVersion:ui.scoreManager.dataVersion};
        const key=JSON.stringify({version:ADVICE_SCENE_VERSION,runId:state.runId,phase,observation,deleteMax:phase==='deletion'?this.deleteMax:0,versions});
        const cached=state.adviceScenes?.[phase];
        if(cached?.version===ADVICE_SCENE_VERSION&&cached.key===key&&validStatus(cached.status))return cached;
        const options={phase,selectedIndices:[],deleteMax:this.deleteMax,calibration:this.calibration,versions,
            catalog:ui.cardManager.allCards,refreshEnabled:state.config?.trainingRefresh?.enabled===true};
        const acquisition=phase==='acquisition'?recommendAcquisition(observation):null;
        const recommend=state.difficulty==='fresh'?recommendFreshStatus:recommendProStatus;
        const optionsWithAcquisition={...options,acquisitionAdvice:acquisition};
        let status=recommend(observation,optionsWithAcquisition);
        if(state.difficulty==='fresh'&&phase==='acquisition'&&status?.preferredIndices){
            const choice=chooseFreshForecastAcquisition(observation,acquisition,status.preferredIndices);
            if(choice)status=recommend(observation,{...optionsWithAcquisition,preferredAcquisition:choice.indices});
        }
        if(!validStatus(status))return null;
        const aligned=alignAcquisitionWithStatus(acquisition,status);
        status=withSOutlook(status,estimateSOutlook(observation,phase==='deletion'?'meeting':'training'));
        // 選択肢の投影は計算中だけ保持し、中断データへは確定結果だけ保存する。
        const {alternatives,...savedStatus}=status;
        // 初回表示も保存形式へ正規化し、再開後の -0／省略フィールドとの差をなくす。
        const scene=JSON.parse(JSON.stringify({version:ADVICE_SCENE_VERSION,key,observation,status:savedStatus,acquisition:aligned}));
        state.adviceScenes={...state.adviceScenes,[phase]:scene};
        ui.saveGameState?.();
        return scene;
    }
    refresh(){
        if(!this.view||this.disposed)return;
        try{
            this.lastAdvice=this.ui.gameState.battle?.kind==='cpu'
                ? this.eligible()?this.getOpponentAdvice():null
                : this.getSceneDecision()?.status||null;
            if(this.lastAdvice)this.view.show(this.lastAdvice);else this.view.hide();
        }catch(error){this.lastAdvice=null;this.view.hide();if(globalThis.window?.CDG_DEBUG)console.warn('[あひる先生]',error.message);}
    }
    getOpponentAdvice() {
        const { gameState: state, battleController } = this.ui;
        const { battle, turn, phase, difficulty } = state;
        const { opponent } = battle;
        const previous = this.opponentAdvice;
        if (previous?.opponent === opponent && previous.turn === turn && previous.phase === phase) return previous.status;
        const round = opponent.turns[turn];
        const offer = phase === 'training' && round?.training.find(event => event.kind === 'training-offer')?.state;
        const snapshot = offer || opponentSnapshot(battle, turn, phase);
        const owned = snapshotCards(snapshot).map(id => opponent.instances[id]).filter(card => card && !card.autoGenerated);
        const observation = { difficulty, turn, stats: snapshot.player, tokens: snapshot.tokens, owned,
            rankTable: opponent.definitions.ranks, mode: opponent.metadata.eventId ? 'event' : 'normal' };
        const speech = phase === 'action' ? { tone: 'yellow', text: '発動条件と配置順を確認するね' } : battleController.cpuAdvice();
        const status = withSOutlook(speech, estimateSOutlook(observation, phase), 'だね');
        this.opponentAdvice = { opponent, turn, phase, status };
        return status;
    }
    reset(){this.phase=null;this.deleteMax=0;this.runRecord=null;this.lastAdvice=null;this.actionScene=null;this.opponentAdvice=null;this.view?.reset();}
    destroy(){this.disposed=true;this.view?.destroy();}
}

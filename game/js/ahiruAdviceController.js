import {loadAdviceCalibration} from './ahiruCalibrationLoader.js?v=20260815-0060';
import {AhiruAdviceView} from './ahiruAdviceView.js?v=20260815-0060';
import {createAdvisorObservation,recommendAcquisition} from './acquisitionAdvisor.js?v=20260815-0060';
import {alignAcquisitionWithStatus} from './proAcquisitionConsistency.js?v=20260815-0060';
import {recommendProStatus} from './ahiruProAdvice.js?v=20260815-0060';
import {recommendFreshStatus} from './ahiruFreshAdvice.js?v=20260815-0060';
export const ADVICE_SCENE_VERSION=1;
const validStatus=status=>status&&['red','yellow','green'].includes(status.tone)&&typeof status.text==='string'&&status.text.trim()&&Array.from(status.text).length<=25;
/** 確定状態と提示候補のスナップショットを、助言・取得アシストで共有する。 */
export class AhiruAdviceController {
    constructor(ui,{calibrationTimeoutMs=3000}={}){this.calibrationTimeoutMs=calibrationTimeoutMs;this.ui=ui;this.phase=null;this.deleteMax=0;this.models=new Map();this.scheduled=false;this.disposed=false;}
    get modelStatus(){return this.models.get(this.ui.gameState.difficulty)?.status||'unloaded';}
    get calibration(){return this.models.get(this.ui.gameState.difficulty)?.calibration||null;}
    init(){
        const panel=document.getElementById('full-status-panel');if(!panel)return;
        this.view=new AhiruAdviceView(panel);
        for(const difficulty of ['fresh','pro'])this.loadCalibration(difficulty);
        this.scheduleRefresh();
    }
    setPhase(phase){this.phase=phase;if(!['training','meeting'].includes(phase))this.view?.hide();else this.scheduleRefresh();}
    setDeleteMax(value){this.deleteMax=Math.max(0,Number(value)||0);this.scheduleRefresh();}
    scheduleRefresh(){
        if(!this.view||this.disposed||this.scheduled)return;this.scheduled=true;
        queueMicrotask(()=>{this.scheduled=false;this.refresh();});
    }
    eligible(){return ['fresh','pro'].includes(this.ui.gameState.difficulty)&&['training','meeting'].includes(this.phase||this.ui.gameState.phase);}
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
        if(this.disposed||!this.eligible())return null;
        const ui=this.ui,state=ui.gameState,phase=(this.phase||state.phase)==='meeting'?'deletion':'acquisition';
        if(state.playRecord!==this.runRecord){this.view?.reset();this.runRecord=state.playRecord;}
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
        const status=recommend(observation,{...options,acquisitionAdvice:acquisition});
        if(!validStatus(status))return null;
        const aligned=alignAcquisitionWithStatus(acquisition,status);
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
            const scene=this.getSceneDecision();this.lastAdvice=scene?.status||null;
            if(this.lastAdvice)this.view.show(this.lastAdvice);else this.view.hide();
        }catch(error){this.lastAdvice=null;this.view.hide();if(globalThis.window?.CDG_DEBUG)console.warn('[あひる先生]',error.message);}
    }
    reset(){this.phase=null;this.deleteMax=0;this.runRecord=null;this.lastAdvice=null;this.view?.reset();}
    destroy(){this.disposed=true;this.view?.destroy();}
}

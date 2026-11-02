import {AhiruAdviceView} from './ahiruAdviceView.js?v=20260815-0055';
import {createAdvisorObservation} from './acquisitionAdvisor.js?v=20260815-0055';
import {recommendProStatus} from './ahiruProAdvice.js?v=20260815-0055';
/** 助言の公開入力・表示タイミングだけを管理し、カードや乱数を操作しない。 */
export class AhiruAdviceController {
    constructor(ui){this.ui=ui;this.phase=null;this.deleteMax=0;this.modelStatus='unloaded';this.calibration=null;this.scheduled=false;this.disposed=false;}
    init(){
        const panel=document.getElementById('full-status-panel');if(!panel)return;
        this.view=new AhiruAdviceView(panel);this.scheduleRefresh();
    }
    setPhase(phase){this.phase=phase;if(!['training','meeting'].includes(phase))this.view?.hide();else this.scheduleRefresh();}
    setDeleteMax(value){this.deleteMax=Math.max(0,Number(value)||0);this.scheduleRefresh();}
    scheduleRefresh(){
        if(!this.view||this.disposed||this.scheduled)return;this.scheduled=true;
        queueMicrotask(()=>{this.scheduled=false;this.refresh();});
    }
    eligible(){return this.ui.gameState.difficulty==='pro'&&['training','meeting'].includes(this.phase||this.ui.gameState.phase);}
    loadCalibration(){
        this.modelStatus='loading';
        const url=new URL('../data/ahiru/pro-projection-calibration.json',import.meta.url);url.search=new URL(import.meta.url).search;
        fetch(url).then(r=>{if(!r.ok)throw Error('calibration unavailable');return r.json();}).then(data=>{this.calibration=data;this.modelStatus='ready';}).catch(()=>{this.modelStatus='failed';}).finally(()=>this.scheduleRefresh());
    }
    refresh(){
        if(!this.view||this.disposed)return;
        if(!this.eligible()){this.view.hide();this.lastAdvice=null;return;}
        if(this.modelStatus==='unloaded'){this.loadCalibration();return;}
        if(this.modelStatus==='loading')return;
        const ui=this.ui,state=ui.gameState,phase=(this.phase||state.phase)==='meeting'?'deletion':'acquisition';
        if(state.playRecord!==this.runRecord){this.view.reset();this.runRecord=state.playRecord;}
        try{
            const inspiration=ui.trainingSelectionMode==='inspiration',cards=phase==='acquisition'?(state.currentTrainingCards||[]):[],pickCount=state.turn===0&&!inspiration?2:1;
            const observation=createAdvisorObservation(state,cards,{pickCount,allowSkip:inspiration,rankTable:ui.scoreManager.rankTable});
            let selectedIndices;
            if(phase==='acquisition'){
                if(!cards.length){this.view.hide();return;}
                const selected=state.turn===0&&!inspiration?ui.selectedInitialCards||[]:[ui.selectedTrainingCard].filter(c=>c&&!c.__skip);
                selectedIndices=selected.map(c=>cards.findIndex(candidate=>String(candidate.cardNo)===String(c.cardNo))).filter(i=>i>=0);
            }else{
                const owned=state.getOwnedCards().slice().sort((a,b)=>Number(a.cardNo)-Number(b.cardNo)||(a.effect||'').localeCompare(b.effect||'')),selected=new Set(ui.selectedCardsForDeletion||[]);
                selectedIndices=owned.flatMap((card,index)=>selected.has(card)?[index]:[]);
            }
            const advice=recommendProStatus(observation,{phase,selectedIndices,deleteMax:this.deleteMax,calibration:this.calibration,versions:{cardVersion:ui.cardManager.dataVersion,rankVersion:ui.scoreManager.dataVersion}});
            this.lastAdvice=advice;if(advice)this.view.show(advice);else this.view.hide();
        }catch(error){this.lastAdvice=null;this.view.hide();if(globalThis.window?.CDG_DEBUG)console.warn('[あひる先生]',error.message);}
    }
    reset(){this.phase=null;this.deleteMax=0;this.runRecord=null;this.lastAdvice=null;this.view?.reset();}
    destroy(){this.disposed=true;this.view?.destroy();}
}

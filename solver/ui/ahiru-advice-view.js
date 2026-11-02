/** 表示のみを担当する。パラメータ評価やカード選択は行わない。統合前の準備用。 */
const FACES=Object.freeze({red:{file:'worried.svg',name:'心配'},yellow:{file:'notice.svg',name:'気づき'},green:{file:'happy.svg',name:'順調'}});
let nextId=0;
export class AhiruAdviceView {
    constructor(statusPanel,{assetBase='../game/data/ahiru/'}={}) {
        if(!statusPanel?.parentNode)throw new Error('パラメータ欄が必要です');
        const doc=statusPanel.ownerDocument;
        this.host=doc.createElement('div');
        this.host.className='ahiru-advice';
        this.host.hidden=true;
        this.button=doc.createElement('button');
        this.button.className='ahiru-advice__face';
        this.button.type='button';
        this.image=doc.createElement('img');
        this.image.alt='';
        this.image.width=44;this.image.height=44;
        this.button.append(this.image);
        this.speech=doc.createElement('div');
        this.speech.className='ahiru-advice__speech';
        this.speech.id=`ahiru-speech-${nextId++}`;
        this.speech.setAttribute('role','status');
        this.speech.setAttribute('aria-live','polite');
        this.speech.setAttribute('aria-atomic','true');
        this.button.setAttribute('aria-controls',this.speech.id);
        this.host.append(this.button,this.speech);
        statusPanel.insertAdjacentElement('afterend',this.host);
        this.assetBase=assetBase.endsWith('/')?assetBase:assetBase+'/';
        this.open=false;this.disposed=false;
        this.onClick=()=>{this.open=!this.open;this.updateExpanded();};
        this.button.addEventListener('click',this.onClick);
        this.updateExpanded();
    }
    updateExpanded() {
        this.button.setAttribute('aria-expanded',String(this.open));
        this.button.setAttribute('aria-label',`あひる先生のアドバイスを${this.open?'閉じる':'開く'}${this.tone?'・'+FACES[this.tone].name:''}`);
        this.speech.hidden=!this.open;
    }
    show({tone,text}) {
        if(this.disposed)throw new Error('破棄済みの表示です');
        // 失敗時も、現在の表示を半端に書き換えない。
        if(!Object.hasOwn(FACES,tone)||typeof text!=='string'||!text.trim()||Array.from(text).length>25||/[\r\n]/.test(text))throw new Error('セリフは改行なし25文字以内、状態は赤・黄・緑です');
        this.tone=tone;
        this.image.src=this.assetBase+FACES[tone].file;
        this.host.dataset.tone=tone;
        this.speech.textContent=text;
        this.host.hidden=false;
        this.updateExpanded();
    }
    hide() {this.host.hidden=true;}
    reset() {this.open=false;this.tone=null;this.speech.textContent='';this.hide();this.updateExpanded();}
    destroy() {
        this.button.removeEventListener('click',this.onClick);
        this.host.remove();this.disposed=true;
    }
}

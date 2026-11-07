/** 通知を、現在表示しているヘッダーと四辺の安全領域の内側へ置く。 */
export class FloatNotificationView {
    show(message,type='info'){
        this.clear();
        const element=document.createElement('div');this.element=element;
        element.className=`float-notification float-${type}`;element.textContent=message;
        element.setAttribute('role','status');element.setAttribute('aria-live','polite');
        document.body.append(element);
        const schedule=()=>{this.update();cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>this.update());};
        this.schedule=schedule;
        window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,{passive:true});
        window.visualViewport?.addEventListener('resize',schedule);
        this.resizeObserver=new ResizeObserver(schedule);
        this.mutationObserver=new MutationObserver(schedule);
        this.mutationObserver.observe(document.body,{childList:true});
        const sticky=document.getElementById('sticky-header');
        if(sticky)this.mutationObserver.observe(sticky,{attributes:true,attributeFilter:['class']});
        this.update();
        this.timer=setTimeout(()=>{element.classList.add('fade-out');this.timer=setTimeout(()=>this.clear(),300);},3000);
    }
    update(){
        if(!this.element)return;
        const root=getComputedStyle(document.documentElement),safe=parseFloat(root.getPropertyValue('--app-safe-top'))||parseFloat(getComputedStyle(document.body).paddingTop)||0;
        const info=document.querySelector('.info-overlay-header');
        const sticky=document.querySelector('#sticky-header:not(.hidden)');
        const header=info||sticky||document.getElementById('full-header');
        if(this.header!==header){this.resizeObserver.disconnect();if(header)this.resizeObserver.observe(header);this.header=header;}
        // 追従ヘッダーの出現アニメーション中も、移動後の領域を先に予約する。
        const bottom=info?info.getBoundingClientRect().bottom:sticky?sticky.offsetHeight:header?.getBoundingClientRect().bottom||0,top=Math.max(safe,bottom)+8;
        this.element.style.setProperty('--notification-top',`${top}px`);
    }
    clear(){
        clearTimeout(this.timer);cancelAnimationFrame(this.frame);
        if(this.schedule){window.removeEventListener('resize',this.schedule);window.removeEventListener('scroll',this.schedule);window.visualViewport?.removeEventListener('resize',this.schedule);}
        this.resizeObserver?.disconnect();this.mutationObserver?.disconnect();this.header=null;
        this.element?.remove();this.element=null;
    }
}

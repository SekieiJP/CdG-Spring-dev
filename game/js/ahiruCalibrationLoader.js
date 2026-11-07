/** 任意の補正データが通信や本文の待機で助言を止め続けないようにする。 */
export async function loadAdviceCalibration(url,{timeoutMs=3000,fetchImpl=globalThis.fetch}={}){
    if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('補正読込の待機時間が不正');
    const controller=new AbortController();let timer;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('補正読込の時間切れ'));controller.abort();},timeoutMs);});
    const request=async()=>{const response=await fetchImpl(url,{signal:controller.signal});if(!response.ok)throw Error('補正データを取得できない');return response.json();};
    // Abortを無視する通信や、JSON本文だけが止まる場合も、期限で呼び出し元へ戻す。
    try{return await Promise.race([request(),deadline]);}finally{clearTimeout(timer);}
}

async (page) => {
  const browser=await page.context().browser().browserType().launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const context=await browser.newContext({viewport:{width:1365,height:900}});
  const tab=await context.newPage();const errors=[];let requests=0;let behavior='success';const assets=[];
  tab.on('pageerror',e=>errors.push(e.message));tab.on('request',r=>assets.push(r.url()));
  const assert=(v,m)=>{if(!v)throw Error(m);};
  await tab.route('**/api/cloud/recognize',async route=>{
    requests++;assert(route.request().headers()['x-signtalk-consent']==='yes','Missing consent header');
    assert(!route.request().headers()['x-goog-api-key'],'Key leaked to browser');
    if(behavior==='slow')await new Promise(r=>setTimeout(r,2000));
    await route.fulfill({status:behavior==='quota'?429:200,contentType:'application/json',body:JSON.stringify(behavior==='quota'?{error:'quota_zero'}:{status:'recognized',text:'Куда (направление)',model:'gemini-4-argon'})}).catch(()=>{});
  });
  try{
    await tab.goto(new URL(page.url()).origin);
    assert(!assets.some(u=>u.endsWith('.onnx')||u.endsWith('.task')),'Cloud loaded local ML unnecessarily');
    await tab.getByLabel('Текст результата',{exact:true}).fill('Спасибо');
    assert(await tab.getByLabel('Текст результата',{exact:true}).inputValue()==='Спасибо','Manual input failed');
    await tab.getByRole('button',{name:'Показать крупно',exact:true}).click();
    await tab.getByRole('dialog').waitFor();await tab.keyboard.press('Escape');
    await tab.getByRole('button',{name:'Записать жест',exact:true}).click();
    const consent=tab.getByRole('checkbox',{name:'Разрешаю отправить это видео Google для распознавания.',exact:true});
    await consent.waitFor({timeout:15000});
    const recognize=tab.getByRole('button',{name:'Распознать видео',exact:true});
    assert(await recognize.isDisabled(),'Send available before consent');assert(requests===0,'Video sent without consent');
    await consent.check();await recognize.click();
    await tab.getByRole('button',{name:'В сообщение',exact:true}).waitFor();
    assert(await tab.getByLabel('Текст результата',{exact:true}).inputValue()==='Спасибо','Result replaced text without confirmation');
    await tab.getByRole('button',{name:'В сообщение',exact:true}).click();
    assert(await tab.getByLabel('Текст результата',{exact:true}).inputValue()==='Куда (направление)','Pick failed');
    behavior='quota';await recognize.click();await tab.getByRole('alert').filter({hasText:'нулевая квота'}).waitFor();
    behavior='slow';await recognize.click();await tab.getByRole('button',{name:'Отменить',exact:true}).click();
    await tab.waitForTimeout(2200);assert(await tab.getByRole('button',{name:'В сообщение',exact:true}).count()===0,'Stale result survived cancel');
    await tab.getByRole('button',{name:'Переснять',exact:true}).click();
    await tab.waitForFunction(()=>document.querySelector('video')?.srcObject?.getTracks().some(t=>t.readyState==='live'));
    await tab.evaluate(()=>window.__tracks=document.querySelector('video').srcObject.getTracks());
    await tab.getByRole('link',{name:'Помощь',exact:true}).click();
    await tab.waitForFunction(()=>window.__tracks.every(t=>t.readyState==='ended'),{timeout:5000});
    assert(await tab.evaluate(()=>window.__tracks.every(t=>t.readyState==='ended')),'Leaving screen kept camera active');
    assert(errors.length===0,errors.join('\n'));
    return {checks:['no local model download on cloud home','manual result text','large text dialog','silent synthetic camera capture','consent gate','explicit result confirmation','quota error','request cancellation','stale result rejection','camera release on navigation'],requests,errors};
  }finally{await browser.close();}
}



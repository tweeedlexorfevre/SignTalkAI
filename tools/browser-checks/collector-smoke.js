async (page) => {
  const browser = await page.context().browser().browserType().launch({
    channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const context = await browser.newContext({ viewport: {width:1280,height:900}, acceptDownloads:true });
  const tab = await context.newPage();
  const errors = [];
  tab.on('pageerror', e => errors.push(e.message));
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  try {
    await tab.addInitScript(() => {
      // Synthetic landmark worker, used solely to exercise UI/persistence.
      const NativeWorker = window.Worker;
      window.Worker = class {
        constructor(url, options) {
          if (!String(url).includes('tracker.worker')) return new NativeWorker(url, options);
          this.onmessage = null; this.closed = false;
        }
        postMessage(msg) {
          if (msg.type === 'init') queueMicrotask(() => this.onmessage?.({data:{type:'ready',delegate:'CPU'}}));
          if (msg.type === 'frame') {
            msg.bitmap.close();
            const frame = new Float32Array(543*3).fill(NaN);
            if (!window.__emptyDatasetHands) for (let i=0;i<21;i++) {
              frame.set([.3+(i%5)*.03+Math.sin(msg.t/300)*.02,.4+Math.floor(i/5)*.03,-i*.001],(468+i)*3);
            }
            setTimeout(() => { if(!this.closed) this.onmessage?.({data:{type:'landmarks',t:msg.t,ms:5,poses:1,hands:1,frame}}); },5);
          }
        }
        terminate() { this.closed=true; }
      };
    });
    await tab.goto(new URL(page.url()).origin);
    await tab.getByRole('link',{name:'Сбор примеров',exact:true}).click();
    assert(await tab.getByRole('button',{name:'Включить камеру',exact:true}).count() === 0,'Consent gate missing');
    await tab.getByLabel('Идентификатор класса',{exact:true}).fill('salem');
    await tab.getByLabel('Название на русском',{exact:true}).fill('Синтетический тест');
    await tab.getByLabel('Название на казахском',{exact:true}).fill('Синтетикалық тест');
    await tab.getByLabel('Псевдоним участника',{exact:true}).fill('SYNTHETIC_ONLY');
    await tab.getByRole('checkbox').check();
    await tab.getByRole('button',{name:'Включить камеру',exact:true}).click();
    const record = tab.getByRole('button',{name:'Записать пример',exact:true});
    await record.waitFor({state:'visible'});
    await tab.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Записать пример'))?.disabled);
    await record.click();
    await tab.getByRole('button',{name:'Отменить запись',exact:true}).click();
    assert(await tab.getByRole('button',{name:'Сохранить пример',exact:true}).count() === 0,'Cancelled draft survived');
    await record.click();
    const save = tab.getByRole('button',{name:'Сохранить пример',exact:true});
    await save.waitFor({state:'visible',timeout:12000});
    assert(await save.isEnabled(),'Good synthetic sample rejected');
    await save.click();
    await tab.getByText('Пример сохранён на устройстве.',{exact:true}).waitFor();
    assert((await tab.locator('.dataset-list > li').count())===1,'Save failed');
    const downloadPromise=tab.waitForEvent('download');
    await tab.getByRole('button',{name:'Экспорт JSON',exact:true}).click();
    const download=await downloadPromise;
    const stream = await download.createReadStream();
    let body = ''; for await (const chunk of stream) body += chunk.toString();
    const exported = JSON.parse(body);
    assert(exported.schemaVersion === 'signtalk.hands.v1' && exported.samples.length === 1, 'Invalid exported file');
    assert(exported.samples[0].camera.width > 0 && exported.samples[0].frames.length >= 12, 'Missing capture metadata');
    await tab.reload();
    await tab.getByRole('link',{name:'Сбор примеров',exact:true}).click();
    await tab.locator('.dataset-list > li').waitFor();
    await tab.getByRole('button',{name:'Исправить метку',exact:true}).click();
    await tab.getByLabel('Название на русском',{exact:true}).fill('Исправленный тест');
    await tab.getByRole('button',{name:'Сохранить метку',exact:true}).click();
    await tab.getByText('Метка исправлена.',{exact:true}).waitFor();
    assert((await tab.locator('.dataset-list').textContent()).includes('Исправленный тест'),'Relabel failed');
    await tab.getByRole('button',{name:'Повторить запись',exact:true}).click();
    await tab.getByRole('checkbox').check();
    await tab.getByRole('button',{name:'Включить камеру',exact:true}).click();
    await tab.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Записать пример'))?.disabled);
    await record.click();
    await tab.getByRole('button',{name:'Сохранить вместо прежнего',exact:true}).waitFor({state:'visible',timeout:12000});
    assert((await tab.locator('.dataset-list > li').count())===1,'Retake destroyed prior record');
    await tab.getByRole('button',{name:'Сохранить вместо прежнего',exact:true}).click();
    await tab.getByText('Пример сохранён на устройстве.',{exact:true}).waitFor();
    assert((await tab.locator('.dataset-list > li').count())===1,'Retake duplicated record');
    await tab.evaluate(()=>window.__emptyDatasetHands=true);
    await record.click();
    await save.waitFor({state:'visible',timeout:12000});
    assert(await save.isDisabled(),'Empty hands accepted');
    await tab.getByRole('button',{name:'Отбросить',exact:true}).click();
    await tab.getByRole('checkbox').uncheck();
    assert(await tab.locator('video').count()===0,'Consent withdrawal kept camera attached');
    await tab.getByRole('button',{name:'Удалить',exact:false}).click();
    await tab.getByText('Пример удалён.',{exact:true}).waitFor();
    assert((await tab.locator('.dataset-list > li').count())===0,'Delete failed');
    assert(errors.length===0,errors.join('\n'));
    return {checks:['consent','countdown cancel','synthetic capture','save','export','reload persistence','relabel','atomic retake','empty hand rejection','withdraw consent','delete'],errors};
  } finally { await browser.close(); }
}



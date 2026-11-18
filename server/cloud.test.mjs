import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { callGemini, extractText, parseRecognition, providerError, createCloudHandler, validVideo,phrasePrompt } from './cloud.mjs';
import { canonicalResult, KRSL_LABELS } from './krsl-vocabulary.mjs';
const video = Buffer.from([0x1a,0x45,0xdf,0xa3,0,0,0,0,0,0,0,0]);
const result = { status:'completed', steps:[{type:'thought',content:[{type:'text',text:'ignore this'}]},{type:'model_output',content:[{type:'text',text:'{"status":"recognized","text":"Привет"}'}]}] };
test('extracts only final output and rejects invented text on uncertain answers',()=>{
  assert.equal(parseRecognition(extractText(result)).text,'Привет');
  assert.deepEqual(parseRecognition('{"status":"uncertain","text":"guessed word"}'),{status:'uncertain',text:''});
  assert.throws(()=>parseRecognition('not JSON'));assert.throws(()=>extractText({...result,status:'incomplete'}));
});
test('forwards video with language, dense sampling and no retained interaction',async()=>{
  const value=await callGemini({key:'test-secret',model:'gemini-2.5-flash',video,mime:'video/webm',language:'krsl',output:'kk',fetcher:async(url,options)=>{
    assert.equal(new URL(url).hostname,'generativelanguage.googleapis.com');assert.equal(options.headers['x-goog-api-key'],'test-secret');
    const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.input[0].processing.fps,20);
    assert.match(body.input[1].text,/Kazakh-Russian/);assert.match(body.input[1].text,/in Kazakh/);return Response.json(result);
  }});assert.equal(value.text,'Привет');
});
test('maps provider errors without exposing raw errors or credentials',()=>{
  assert.equal(providerError(429,{error:{message:'limit: 0 input tokens'}}).code,'quota_zero');
  assert.equal(providerError(503,{}).code,'provider_busy');assert.equal(providerError(401,{}).code,'invalid_key');
  assert.equal(providerError(404,{}).code,'model_unavailable');assert.equal(providerError(500,{error:{message:'test-secret'}}).message,'provider_error');
});
test('dictionary mode canonicalizes both languages and refuses unknown ids',async()=>{
  const recognized=id=>JSON.stringify({status:'recognized',id,text:'invented alternative translation'});
  for(const label of KRSL_LABELS){
    assert.equal(canonicalResult(recognized(label.id),'ru').text,label.ru);
    assert.equal(canonicalResult(recognized(label.id),'kk').text,label.kk);
  }
  assert.equal(canonicalResult(recognized('not-in-dictionary'),'ru').status,'uncertain');
  assert.equal(canonicalResult('{"status":"uncertain","id":"kuda"}','kk').text,'');
  const value=await callGemini({key:'test-secret',model:'gemini-4-argon',video,mime:'video/webm',language:'krsl',output:'kk',vocabulary:'krsl10',fetcher:async(_url,options)=>{
    const body=JSON.parse(options.body);
    assert.equal(body.response_format.mime_type,'application/json');
    assert.ok(body.response_format.schema.properties.id.enum.includes('kuda'));
    assert.match(body.input[1].text,/constrains OUTPUT ONLY/);
    return Response.json({status:'completed',output_text:recognized('kuda')});
  }});
  assert.equal(value.text,'Қайда (бағыт)');assert.equal(value.signId,'kuda');
  await assert.rejects(callGemini({key:'test-secret',model:'gemini-4-argon',language:'asl',output:'ru',vocabulary:'krsl10'}),{code:'invalid_request'});
});
test('rejects invalid model, missing key and invalid video container',async()=>{
  assert.equal(validVideo(video,'video/webm'),true);assert.equal(validVideo(Buffer.from('not a video file'),'video/webm'),false);
  await assert.rejects(callGemini({key:'key',model:'other',check:true}),{code:'invalid_model'});
  await assert.rejects(callGemini({key:'',model:'gemini-2.5-flash',check:true}),{code:'not_configured'});
});
test('phrase assistance asks rather than answering and rejects invented numbers',async()=>{
  assert.match(phrasePrompt('когда сдавать проект','ru'),/Do not answer/);
  assert.throws(()=>phrasePrompt('','ru'));assert.throws(()=>phrasePrompt('текст','en'));
  const response={status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'{"status":"recognized","text":"Встреча в аудитории 203"}'}]}]};
  await assert.rejects(callGemini({key:'secret',model:'gemini-4-argon',phrase:'встреча аудитория 302',language:'ru',fetcher:async()=>Response.json(response)}),{code:'invalid_response'});
});
test('HTTP proxy blocks foreign origins and missing consent and keeps keys private',async()=>{
  let handler;let calls=0;const server=createServer((req,res)=>{void handler(req,res);});
  server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
  handler=createCloudHandler({key:'test-secret',port,fetcher:async()=>{calls++;return Response.json(result);}});
  try{
    const base=`http://127.0.0.1:${port}`;const status=await(await fetch(base+'/api/cloud/status')).text();assert.ok(!status.includes('test-secret'));
    assert.equal((await fetch(base+'/api/cloud/check',{method:'POST'})).status,400);
    assert.equal((await fetch(base+'/api/cloud/check',{method:'POST',headers:{Origin:'https://foreign.example','x-signtalk-consent':'yes'}})).status,403);assert.equal(calls,0);
    const r=await fetch(base+'/api/cloud/recognize',{method:'POST',headers:{'Content-Type':'video/webm','x-signtalk-consent':'yes','x-sign-language':'krsl','x-output-language':'ru'},body:video});
    assert.equal(r.status,200);assert.equal((await r.json()).text,'Привет');assert.equal(calls,1);
  }finally{server.close();server.closeAllConnections();}
});
test('phrase HTTP route requires consent and validates before provider call',async()=>{
  let handler;let calls=0;
  const server=createServer((req,res)=>{void handler(req,res);});
  server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
  handler=createCloudHandler({key:'test-secret',port,fetcher:async(_url,options)=>{
    calls++;const body=JSON.parse(options.body);assert.equal(body.store,false);
    assert.match(JSON.stringify(body.input),/college student/);return Response.json(result);
  }});
  const base=`http://127.0.0.1:${port}/api/cloud/phrase`;
  const headers={'Content-Type':'application/json','x-signtalk-consent':'yes'};
  try{
    assert.equal((await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
    assert.equal((await fetch(base,{method:'POST',headers:{...headers,Origin:'https://foreign.example'},body:'{}'})).status,403);
    assert.equal(calls,0);
    const r=await fetch(base,{method:'POST',headers,body:JSON.stringify({text:'когда сдать работу',language:'ru'})});
    assert.equal(r.status,200);assert.equal((await r.json()).text,'Привет');assert.equal(calls,1);
    assert.equal((await fetch(base,{method:'POST',headers,body:'{}'})).status,429);
    handler=createCloudHandler({key:'test-secret',port,fetcher:async()=>{calls++;return Response.json(result);}});
    assert.equal((await fetch(base,{method:'POST',headers,body:'null'})).status,400);
    assert.equal(calls,1);
  }finally{server.close();server.closeAllConnections();}
});

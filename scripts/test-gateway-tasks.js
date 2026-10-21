#!/usr/bin/env node
// Real request builders, task pipeline and persistence against a fake UXP host.
// The sole network integration uses an ephemeral loopback HTTP server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { createContext } = require('./smoke-plugin');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
let passed = 0;
function boot() {
  const context = createContext();
  context.console = { log() {}, warn() {}, error() {} };
  context.AbortController = AbortController;
  context.fetch = async () => { throw new Error('External network forbidden'); };
  vm.createContext(context);
  vm.runInContext(source, context);
  vm.runInContext(`
    loadSettings();
    $('baseUrlInput').value='https://gateway.example.invalid/v1';
    $('apiKeyInput').value='offline-dummy'; $('promptInput').value='edit';
    app.activeDocument={id:101,name:'Source',width:100,height:80};
    globalThis.fixture=bytesToBase64(encodePngRgba(1,1,new Uint8Array([255,0,0,128])));
    globalThis.reply=(status,body)=>({ok:status>=200&&status<300,status,statusText:'test',text:async()=>JSON.stringify(body)});
    globalThis.imports=[];
    getSelectionInfo=async()=>({left:2,top:3,right:22,bottom:13,width:20,height:10});
    placeResultAsLayer=async(item,rect)=>{imports.push({id:item.id,doc:app.activeDocument.id,rect});};
    saveDebugJsonFile=async()=>{};
    prepareCroppedPreviews=async()=>{};
  `, context);
  return { context, run: code => vm.runInContext(`(async()=>{${code}})()`, context),
    api: vm.runInContext('({state,app,loadHistory,saveHistoryItem,runGeneration,importSelected,bindSelectedResultToDocument})', context) };
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
async function main() {
  await test('gateway configuration persists protocol, custom paths and opaque model IDs', async () => {
    const b=boot(); const r=await b.run(`
      $('apiProtocolInput').value='responses';$('responsesPathInput').value='/internal/responses';
      $('responsesModelInput').value='internal-controller';$('modelInput').value='internal-image-fast';
      $('fastModelInput').value='internal-image-fast';$('deepModelInput').value='internal-image-deep';
      saveSettings();loadSettings();return getSettings();`);
    assert.equal(r.apiProtocol,'responses');assert.equal(r.responsesPath,'/internal/responses');
    assert.equal(r.model,'internal-image-fast');assert.equal(r.responsesModel,'internal-controller');
    assert.equal(r.deepModel,'internal-image-deep');
  });
  await test('key import preserves internal gateway, models and protocol', async()=>{
    const b=boot();const r=await b.run(`
      $('apiProtocolInput').value='responses';$('modelInput').value='custom-image';
      $('authJsonInput').value='sk-offline-dummy-12345678901234567890';applyAuthJson();return getSettings();`);
    assert.equal(r.baseUrl,'https://gateway.example.invalid/v1');assert.equal(r.model,'custom-image');assert.equal(r.apiProtocol,'responses');
  });
  await test('model 404 explains model access without claiming the endpoint is absent',async()=>{
    const b=boot();const message=await b.run("return formatOpenAIResponseError({status:404},'model_not_found: model not found',{endpointPath:'/images/edits'});");
    assert.match(message,/Model ID/);assert(!message.includes('/responses'));assert(!message.includes('没有找到'));
  });
  await test('Images protocol accepts screenshot and manual references without any mask', async()=>{
    const b=boot();const r=await b.run(`
      const calls=[];sendRequest=async(url,o)=>{calls.push({url,fields:[...o.body.keys()],prompt:o.body.get('prompt')});return reply(200,{data:[{b64_json:fixture}]});};
      for(const opts of [{screenshotReferenceEdit:true},{manualReferenceEdit:true}]) await requestSingleEdit(getSettings(),'edit',fixture,null,opts);
      return calls;`);
    assert.equal(r.length,2);for(const c of r){assert(c.url.endsWith('/images/edits'));assert(!c.fields.includes('mask'));assert(c.fields.includes('image'));}
  });
  await test('Responses uses custom controller, image alias and path, preserving transparent PNG',async()=>{
    const b=boot();const r=await b.run(`
      let call;sendRequest=async(url,o)=>{call={url,payload:JSON.parse(o.body)};return reply(200,{output:[{type:'image_generation_call',result:fixture}]});};
      await requestSingleEdit({...getSettings(),apiProtocol:'responses',responsesPath:'/custom/response',responsesModel:'controller-alias',model:'image-alias',background:'transparent'},'edit',fixture,null,{screenshotReferenceEdit:true});return call;`);
    assert(r.url.endsWith('/custom/response'));assert.equal(r.payload.model,'controller-alias');
    assert.equal(r.payload.tools[0].model,'image-alias');assert.equal(r.payload.tools[0].background,'transparent');
    assert.equal(r.payload.tools[0].output_format,'png');assert(!r.payload.tools[0].input_image_mask);
  });
  await test('model 404 never changes protocol or poisons the next model request',async()=>{
    const b=boot();const r=await b.run(`
      const calls=[];sendRequest=async(url,o)=>{calls.push(url);return calls.length===1?reply(404,{error:{code:'model_not_found',message:'model not found'}}):reply(200,{data:[{b64_json:fixture}]});};
      try{await requestSingleGeneration(getSettings(),'draw');}catch(e){}
      await requestSingleGeneration({...getSettings(),model:'available'},'draw');return calls;`);
    assert.equal(r.length,2);assert(r.every(url=>url.endsWith('/images/generations')));
  });
  await test('unavailable Responses controller is reported without silently changing models',async()=>{
    const b=boot();const r=await b.run(`
      const models=[];sendRequest=async(url,o)=>{models.push(JSON.parse(o.body).model);return reply(404,{error:{code:'model_not_found',message:'model not found'}});};
      try{await requestResponsesTextImageGeneration({...getSettings(),responsesModel:'chosen-controller'},'draw');}catch(e){}
      return models;`);assert.deepEqual(plain(r),['chosen-controller']);
  });
  await test('text-only Responses output retains a readable no-image error on both paths',async()=>{
    const b=boot();const r=await b.run(`
      sendRequest=async()=>reply(200,{output:[{type:'message',content:[{type:'output_text',text:'Cannot generate image'}]}]});
      const errors=[];for(const fn of [()=>requestResponsesTextImageGeneration(getSettings(),'draw'),()=>requestResponsesImageEditFallback(getSettings(),'edit',fixture,null)]){
        try{await fn();}catch(e){errors.push({name:e.name,message:e.message});}}
      return errors;`);
    assert.equal(r.length,2);for(const e of r){assert.notEqual(e.name,'ReferenceError');assert.match(e.message,/没有返回 image_generation_call/);assert.match(e.message,/Cannot generate/);}
  });
  await test('XHR timeout does not resubmit the billable POST through fetch',async()=>{
    const b=boot();const r=await b.run(`
      let xhr=0,fetched=0;globalThis.XMLHttpRequest=class{open(){}setRequestHeader(){}send(){xhr++;Promise.resolve().then(()=>this.ontimeout());}};
      fetch=async()=>{fetched++;return reply(200,{});};let unknown;
      try{await sendRequest('https://gateway.example.invalid/edits',{method:'POST',forceXhr:true,body:'offline'});}catch(e){unknown=e.outcomeUnknown;}
      return {xhr,fetched,unknown};`);
    assert.equal(r.xhr,1);assert.equal(r.fetched,0);assert.equal(r.unknown,true);
  });
  await test('fetch deadline aborts the underlying request including a stalled response body',async()=>{
    const b=boot();const r=await b.run(`
      let signal;fetch=async(u,o)=>{signal=o.signal;return {ok:true,status:200,text:async()=>new Promise(()=>{})};};
      let error;try{await fetchWithTimeout('https://gateway.example.invalid/edits',{method:'POST'},10);}catch(e){error=e.name;}
      return {aborted:signal.aborted,error};`);
    assert.equal(r.error,'RequestTimeoutError');assert.equal(r.aborted,true);
  });
  await test('user abort remains cancellation and never triggers a second transport',async()=>{
    const b=boot();const r=await b.run(`
      const c=new AbortController();let captured;fetch=async(u,o)=>{captured=o.signal;return new Promise(()=>{});};
      const pending=sendRequest('https://gateway.example.invalid/edits',{method:'POST',signal:c.signal});
      await Promise.resolve();c.abort();let name;try{await pending;}catch(e){name=e.name;}
      return {name,aborted:captured.aborted};`);assert.equal(r.name,'AbortError');assert.equal(r.aborted,true);
  });
  await test('second image failure preserves the first in results and durable history',async()=>{
    const b=boot();const r=await b.run(`
      $('countInput').value='2';let calls=0;requestSingleGeneration=async()=>{if(++calls===2)throw new Error('second failed');return [{b64:fixture,format:'png'}];};
      await runGeneration();const count=state.results.length;await loadHistory();return {calls,count,history:state.history.length,imports:imports.length,persisted:state.results[0].persisted};`);
    assert.equal(r.calls,2);assert.equal(r.count,1);assert.equal(r.history,1);assert.equal(r.imports,0);assert.equal(r.persisted,true);
  });
  await test('switching UI mode does not change the running task or its placement',async()=>{
    const b=boot();const r=await b.run(`
      requestSingleGeneration=async()=>{switchMode('outpaint');$('qualityInput').value='max';return [{b64:fixture,format:'png'}];};
      await runGeneration();return {mode:state.results[0].mode,quality:state.results[0].quality,imports:imports.length};`);
    assert.equal(r.mode,'generate');assert.equal(r.quality,'auto');assert.equal(r.imports,1);
  });
  await test('generation fits the captured selection instead of a later live selection',async()=>{
    const b=boot();const r=await b.run(`
      let reads=0;getSelectionInfo=async()=>{reads++;return {left:2,top:3,right:22,bottom:13,width:20,height:10};};
      requestSingleGeneration=async()=>{$('fitSelectionInput').checked=false;getSelectionInfo=async()=>{throw new Error('must not reread selection');};return [{b64:fixture,format:'png'}];};
      await runGeneration();return {reads,rect:imports[0].rect};`);
    assert.equal(r.reads,1);assert.deepEqual(plain(r.rect),{left:2,top:3,right:22,bottom:13,width:20,height:10});
  });
  await test('switching document preserves generated output and prevents automatic and manual import',async()=>{
    const b=boot();const r=await b.run(`
      requestSingleGeneration=async()=>{app.activeDocument={id:202,name:'Other',width:100,height:80};return [{b64:fixture,format:'png'}];};
      await runGeneration();await importSelected();await loadHistory();return {imports:imports.length,history:state.history.length,status:$('statusBar').textContent};`);
    assert.equal(r.imports,0);assert.equal(r.history,1);
  });
  await test('outpaint refuses to expand a different active document after the response',async()=>{
    const b=boot();const r=await b.run(`
      state.mode='outpaint';exportActiveDocumentAsBase64=async()=>fixture;
      createOutpaintInputs=async()=>({image:fixture,mask:fixture,displaySize:'120x80',padding:{left:10,right:10,top:0,bottom:0},baseSize:{width:100,height:80},targetRect:{left:0,top:0,right:120,bottom:80,width:120,height:80},placementRect:{left:0,top:0,right:120,bottom:80,width:120,height:80}});
      requestEdits=async()=>{app.activeDocument={id:202,name:'Other',width:100,height:80};return [{b64:fixture,format:'png'}];};
      normalizeOutpaintResultItems=async items=>items;let expanded=0;expandCanvasForOutpaint=async()=>{expanded++;};
      await runGeneration();return {expanded,imports:imports.length,saved:state.results[0].persisted};`);
    assert.equal(r.expanded,0);assert.equal(r.imports,0);assert.equal(r.saved,true);
  });
  await test('canvas changes are rejected while keeping the accepted image',async()=>{
    const b=boot();const r=await b.run(`
      requestSingleGeneration=async()=>{app.activeDocument.width=120;return [{b64:fixture,format:'png'}];};
      await runGeneration();return {imports:imports.length,saved:state.results[0].persisted};`);
    assert.equal(r.imports,0);assert.equal(r.saved,true);
  });
  await test('late cancellation saves an already returned image and prevents placement',async()=>{
    const b=boot();const r=await b.run(`
      requestSingleGeneration=async()=>{state.cancelRequested=true;return [{b64:fixture,format:'png'}];};
      await runGeneration();await loadHistory();return {history:state.history.length,imports:imports.length};`);
    assert.equal(r.history,1);assert.equal(r.imports,0);
  });
  await test('superseded task cannot publish results or clear the newer task state',async()=>{
    const b=boot();const r=await b.run(`
      requestSingleGeneration=async()=>{state.activeTask={id:'newer'};return [{b64:fixture,format:'png'}];};
      await runGeneration();return {active:state.activeTask.id,busy:state.busy,visible:state.results.length,imports:imports.length};`);
    assert.equal(r.active,'newer');assert.equal(r.busy,true);assert.equal(r.visible,0);assert.equal(r.imports,0);
  });
  await test('history sidecars recover images after index loss and retain native alpha',async()=>{
    const b=boot();const r=await b.run(`
      requestSingleGeneration=async()=>[{b64:fixture,format:'png'}];await runGeneration();
      localStorage.data.delete(HISTORY_KEY);state.history=[];await loadHistory();
      const rgba=await decodePngRgbaBase64(state.history[0].b64);return {count:state.history.length,alpha:rgba.rgba[3],binding:state.history[0].sourceContext.documentId};`);
    assert.equal(r.count,1);assert.equal(r.alpha,128);assert.equal(r.binding,101);
  });
  await test('localStorage quota does not discard an image with a durable sidecar',async()=>{
    const b=boot();const r=await b.run(`
      const original=localStorage.setItem.bind(localStorage);localStorage.setItem=(k,v)=>{if(k===HISTORY_KEY)throw new Error('quota');original(k,v);};
      requestSingleGeneration=async()=>[{b64:fixture,format:'png'}];await runGeneration();await loadHistory();return {count:state.history.length,persisted:state.results[0].persisted};`);
    assert.equal(r.count,1);assert.equal(r.persisted,true);
  });
  await test('disk write failure stops further generation and retains the in-memory image',async()=>{
    const b=boot();const r=await b.run(`
      $('countInput').value='2';let calls=0;requestSingleGeneration=async()=>{calls++;return [{b64:fixture,format:'png'}];};
      getHistoryFolder=async()=>({createFile:async()=>{throw new Error('disk full');}});await runGeneration();
      return {calls,visible:state.results.length,status:$('statusBar').textContent};`);
    assert.equal(r.calls,1);assert.equal(r.visible,1);assert.match(r.status,/结果保存失败/);
  });
  await test('normalization failure retains raw image and blocks unsafe coordinate import',async()=>{
    const b=boot();const r=await b.run(`
      state.mode='inpaint';createInpaintScreenshotInputs=async()=>({image:fixture,apiSize:'auto',displaySize:'20x10',targetRect:{left:2,top:3,right:22,bottom:13,width:20,height:10},placementRect:{left:2,top:3,right:22,bottom:13,width:20,height:10}});
      requestEdits=async()=>[{b64:fixture,format:'png'}];cropScreenshotReferenceEditItems=async()=>{throw new Error('decode failed');};
      await runGeneration();await importSelected();await loadHistory();return {history:state.history.length,pending:state.history[0].pendingProcessing,imports:imports.length};`);
    assert.equal(r.history,1);assert.equal(r.pending,true);assert.equal(r.imports,0);
  });
  await test('failed placement can import the saved output again without generating',async()=>{
    const b=boot();const r=await b.run(`
      let calls=0;requestSingleGeneration=async()=>{calls++;return [{b64:fixture,format:'png'}];};
      placeResultAsLayer=async()=>{throw new Error('host busy');};await runGeneration();
      placeResultAsLayer=async()=>{imports.push('ok');};await importSelected();return {calls,imports:imports.length};`);
    assert.equal(r.calls,1);assert.equal(r.imports,1);
  });
  await test('explicit document binding enables intentional import without another API call',async()=>{
    const b=boot();const r=await b.run(`
      let calls=0;requestSingleGeneration=async()=>{calls++;return [{b64:fixture,format:'png'}];};await runGeneration();
      app.activeDocument={id:202,name:'Chosen',width:100,height:80};await bindSelectedResultToDocument();await importSelected();
      return {calls,document:state.results[0].sourceContext.documentId,imports:imports.length};`);
    assert.equal(r.calls,1);assert.equal(r.document,202);assert.equal(r.imports,2);
  });
  await test('history clear marker prevents cleared sidecars from reappearing',async()=>{
    const b=boot();const r=await b.run(`
      requestSingleGeneration=async()=>[{b64:fixture,format:'png'}];await runGeneration();await clearHistory();localStorage.data.delete(HISTORY_KEY);await loadHistory();return state.history.length;`);
    assert.equal(r,0);
  });
  await test('manual reference pixels are captured before UI reference changes',async()=>{
    const b=boot();const r=await b.run(`
      state.mode='reference';state.manualReferenceImage={b64:fixture,format:'png',width:1,height:1};
      getSelectionInfo=async()=>{state.manualReferenceImage={b64:'changed',width:2,height:2};return null;};
      let sent;requestEdits=async(s,p,image)=>{sent=image;return [{b64:fixture,format:'png'}];};
      await runGeneration();return {sent,expected:fixture,count:state.results.length};`);
    assert.equal(r.sent,r.expected);assert.equal(r.count,1);
  });
  await test('a successful multi-image batch stores one final record per image',async()=>{
    const b=boot();const r=await b.run(`
      $('countInput').value='2';let calls=0;requestSingleGeneration=async()=>{calls++;return [{b64:fixture,format:'png'}];};
      await runGeneration();await loadHistory();return {calls,history:state.history.length,ids:state.history.map(x=>x.id),imports:imports.length};`);
    assert.equal(r.calls,2);assert.equal(r.history,2);assert.equal(new Set(r.ids).size,2);assert.equal(r.imports,2);
  });
  await test('valid JSON of the wrong index type cannot prevent sidecar recovery',async()=>{
    const b=boot();const r=await b.run(`
      requestSingleGeneration=async()=>[{b64:fixture,format:'png'}];await runGeneration();
      localStorage.setItem(HISTORY_KEY,'{}');await loadHistory();const recovered=state.history.length;
      localStorage.setItem(HISTORY_KEY,'[null]');await loadHistory();return [recovered,state.history.length];`);
    assert.deepEqual(plain(r),[1,1]);
  });
  await test('another-session history requires explicit rebinding before import',async()=>{
    const b=boot();const r=await b.run(`
      requestSingleGeneration=async()=>[{b64:fixture,format:'png'}];await runGeneration();imports.length=0;
      state.results[0].sourceContext={...state.results[0].sourceContext,sessionId:'old-session'};
      await importSelected();const before=imports.length;await bindSelectedResultToDocument();await importSelected();return {before,after:imports.length};`);
    assert.equal(r.before,0);assert.equal(r.after,1);
  });
  await test('coordinate-bound history rejects rebinding to a different canvas size',async()=>{
    const b=boot();const r=await b.run(`
      const original=captureResultSourceContext();state.results=[{id:'123-coordinate',mode:'inpaint',b64:fixture,sourceContext:original,
        placementRect:{left:2,top:3,right:22,bottom:13,width:20,height:10}}];state.selectedId='123-coordinate';
      app.activeDocument={id:202,name:'Wrong size',width:200,height:80};await bindSelectedResultToDocument();
      return {boundId:state.results[0].sourceContext.documentId,status:$('statusBar').textContent};`);
    assert.equal(r.boundId,101);assert.match(r.status,/尺寸.*不一致/);
  });
  await test('returned URL image is materialized even when cancellation arrives with the response',async()=>{
    const b=boot();const r=await b.run(`
      let downloads=0;fetch=async()=>{downloads++;return {ok:true,status:200,arrayBuffer:async()=>base64ToArrayBuffer(fixture)};};
      requestSingleGeneration=async()=>{state.cancelRequested=true;return [{url:'https://gateway.example.invalid/result.png',format:'png'}];};
      await runGeneration();await loadHistory();return {downloads,history:state.history.length,url:state.history[0].url||null,alpha:(await decodePngRgbaBase64(state.history[0].b64)).rgba[3]};`);
    assert.equal(r.downloads,1);assert.equal(r.history,1);assert.equal(r.url,null);assert.equal(r.alpha,128);
  });
  await test('actual screenshot normalization and durable history preserve native RGBA bytes',async()=>{
    const b=boot();const r=await b.run(`
      state.mode='inpaint';const rgba=new Uint8Array(4*3*4);for(let i=0;i<rgba.length;i+=4){rgba[i]=220;rgba[i+1]=80;rgba[i+3]=i%3===0?0:128;}
      const image=bytesToBase64(encodePngRgba(4,3,rgba));
      getSelectionInfo=async()=>({left:2,top:3,right:6,bottom:6,width:4,height:3});
      createInpaintScreenshotInputs=async()=>({image,apiSize:'auto',displaySize:'4x3',
        targetRect:{left:2,top:3,right:6,bottom:6,width:4,height:3},placementRect:{left:2,top:3,right:6,bottom:6,width:4,height:3},
        referenceCrop:{canvasWidth:4,canvasHeight:3,left:0,top:0,width:4,height:3,sourceWidth:4,sourceHeight:3}});
      requestEdits=async()=>[{b64:image,format:'png'}];await runGeneration();await loadHistory();
      const saved=await decodePngRgbaBase64(state.history[0].b64);
      return {expected:Array.from(rgba),actual:Array.from(saved.rgba),mode:state.history[0].placementMode,pending:state.history[0].pendingProcessing};`);
    assert.deepEqual(r.actual,r.expected);assert.equal(r.mode,'direct-selection-patch');assert.equal(r.pending,false);
  });
  await test('real loopback gateway accepts JSON generation and multipart no-mask editing',async()=>{
    const b=boot();const image=await b.run('return fixture;');const calls=[];
    const server=http.createServer(async(req,res)=>{
      const parts=[];for await(const part of req)parts.push(part);
      calls.push({url:req.url,body:Buffer.concat(parts).toString(),type:req.headers['content-type']});
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{b64_json:image}]}));
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      b.context.fetch=fetch;b.context.testBase=`http://127.0.0.1:${server.address().port}/v1`;
      const r=await b.run(`
        const s={...getSettings(),baseUrl:testBase,generationPath:'/create',editPath:'/edit',model:'internal-alias'};
        const generated=await requestSingleGeneration(s,'draw');
        const edited=await requestSingleEdit(s,'edit',fixture,null,{screenshotReferenceEdit:true});return [generated.length,edited.length];`);
      assert.deepEqual(plain(r),[1,1]);assert.equal(calls.length,2);
      assert.equal(calls[0].url,'/v1/create');assert.equal(JSON.parse(calls[0].body).model,'internal-alias');
      assert.equal(calls[1].url,'/v1/edit');assert.match(calls[1].type,/multipart\/form-data/);
      assert.match(calls[1].body,/name="image"/);assert(!/name="mask"/.test(calls[1].body));
    } finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
  });
  console.log(`GATEWAY_TASKS_OK tests=${passed}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});

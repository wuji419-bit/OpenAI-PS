#!/usr/bin/env node
// Offline regressions: real plugin helpers and request builders; mocked UXP host.
// No network, credentials, Photoshop process or user documents are accessed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createContext } = require('./smoke-plugin');
const source = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
let passed = 0;

function boot() {
  const context = vm.createContext(createContext());
  vm.runInContext(source, context);
  const api = vm.runInContext(`({app, core, imaging, state, action, loadSettings, getSettings, saveSettings,
    resizeRgbaBilinear, encodePngRgba, bytesToBase64, decodePngRgbaBase64,
    createPaddedScreenshotReferenceBase64, normalizeScreenshotReferenceResultBase64,
    placeResultAsLayer, importSelected, getAlphaBounds, makeOutsideSelectionMask, verifySelectionCompositeAlpha})`, context);
  api.action.batchPlay = async () => { throw new Error('Unexpected Action/transform in native RGBA placement'); };
  return { context, api };
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function png(api, w, h, rgba) { return api.bytesToBase64(api.encodePngRgba(w, h, rgba)); }
function solid(w, h, rgba) {
  const pixels = new Uint8Array(w * h * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set(rgba, i);
  return pixels;
}
function snapshot(doc) {
  const layer = l => ({ id: l.id, name: l.name, visible: l.visible, background: l.isBackgroundLayer,
    pixels: l.pixels ? Array.from(l.pixels) : null, mask: l.mask ? Array.from(l.mask) : null,
    blendMode: l.blendMode, children: l.layers?.map(layer) });
  return JSON.stringify(doc.layers.map(layer));
}
function host(api, { background = false, failAt = '', cancelled = false } = {}) {
  let nextId = 1;
  const events = [], buffers = [];
  const doc = { id: 99, width: 9, height: 7, layers: [], activeLayers: [] };
  const fail = name => { if (name === failAt) throw new Error(`injected:${name}`); };
  const siblings = layer => layer.parent?.layers || doc.layers;
  function layer(name, options = {}) {
    const l = { id: nextId++, name, visible: true, isBackgroundLayer: false, parent: null, ...options };
    l.duplicate = async () => {
      fail('duplicate');
      const copy = layer(name + ' copy', { pixels: l.pixels?.slice(), mask: l.mask?.slice(), visible: l.visible });
      siblings(l).splice(siblings(l).indexOf(l), 0, copy);
      return copy;
    };
    l.move = async (relative, location) => {
      fail('move');
      assert.equal(location, 'placeBefore');
      siblings(l).splice(siblings(l).indexOf(l), 1);
      const target = siblings(relative);
      target.splice(target.indexOf(relative), 0, l);
      l.parent = relative.parent;
    };
    Object.defineProperty(l, 'bounds', { get() {
      const b = l.pixels ? api.getAlphaBounds(l.pixels, doc.width, doc.height, 0) : null;
      return b || { left: 0, top: 0, right: 0, bottom: 0 };
    }});
    return l;
  }
  const original = layer('Original pixels and mask', { isBackgroundLayer: background,
    pixels: solid(doc.width, doc.height, [20, 80, 180, 255]), mask: new Uint8Array(doc.width * doc.height).fill(255) });
  doc.layers.push(original);
  doc.activeLayers = [original];
  doc.createLayerGroup = async ({ name, fromLayers }) => {
    fail('createLayerGroup');
    assert(fromLayers.every(l => !l.isBackgroundLayer), 'Background must not be grouped directly');
    assert(fromLayers.every(l => l.parent === null), 'Only complete root stacks may be wrapped');
    const group = layer(name, { layers: fromLayers.slice() });
    const index = Math.min(...fromLayers.map(l => doc.layers.indexOf(l)));
    doc.layers = doc.layers.filter(l => !fromLayers.includes(l));
    doc.layers.splice(index, 0, group);
    for (const l of fromLayers) l.parent = group;
    doc.activeLayers = [group];
    return group;
  };
  doc.createPixelLayer = async ({ name }) => {
    fail('createPixelLayer');
    // Simulate Photoshop creating inside the selected group; code must move out.
    const parent = doc.activeLayers[0]?.layers ? doc.activeLayers[0] : null;
    const l = layer(name, { parent, pixels: new Uint8Array(doc.width * doc.height * 4) });
    (parent?.layers || doc.layers).unshift(l);
    doc.activeLayers = [l];
    return l;
  };
  const allLayers = () => {
    const list = []; const visit = ls => ls.forEach(l => { list.push(l); if (l.layers) visit(l.layers); });
    visit(doc.layers); return list;
  };
  api.app.activeDocument = doc;
  api.core.executeAsModal = async fn => {
    let saved;
    return fn({ isCancelled: cancelled, hostControl: {
      async suspendHistory() {
        saved = { roots: doc.layers.slice(), active: doc.activeLayers.slice(),
          layers: allLayers().map(l => [l, { ...l, layers: l.layers?.slice(), pixels: l.pixels?.slice(), mask: l.mask?.slice() }]) };
        events.push(['history', 'suspend']); return { id: 'history' };
      },
      async resumeHistory(id, commit) {
        events.push(['history', commit]);
        if (!commit) {
          doc.layers = saved.roots; doc.activeLayers = saved.active;
          for (const [l, data] of saved.layers) {
            for (const [key, value] of Object.entries(data)) if (key !== 'bounds') l[key] = value;
          }
        }
      },
    }});
  };
  api.imaging.createImageDataFromBuffer = async (data, options) => {
    const imageData = { ...options, data: data.slice(), disposed: false, dispose() { this.disposed = true; } };
    buffers.push(imageData); return imageData;
  };
  api.imaging.putLayerMask = async options => {
    fail('putLayerMask');
    assert.equal(options.replace, true);
    assert.equal(options.imageData.components, 1);
    assert.deepEqual(plain(options.targetBounds), { left: 0, top: 0 });
    const l = allLayers().find(l => l.id === options.layerID);
    assert(l.layers, 'Replacement mask belongs on a new source GROUP, never an existing mask');
    l.mask = options.imageData.data.slice();
    events.push(['mask', options.layerID]);
  };
  api.imaging.putPixels = async options => {
    fail('putPixels');
    assert.equal(options.documentID, doc.id);
    assert.equal(options.replace, true);
    const l = allLayers().find(l => l.id === options.layerID);
    const { width, height, data } = options.imageData;
    const { left, top } = options.targetBounds;
    for (let y = 0; y < height; y++) {
      l.pixels.set(data.subarray(y * width * 4, (y + 1) * width * 4), ((top + y) * doc.width + left) * 4);
    }
    events.push(['pixels', plain(options.targetBounds), width, height, Array.from(data)]);
  };
  function composite(layers) {
    const output = new Uint8Array(doc.width * doc.height * 4);
    for (const l of layers.slice().reverse()) {
      if (!l.visible) continue;
      const pixels = l.layers ? composite(l.layers) : l.pixels;
      for (let i = 0; i < output.length; i += 4) {
        const a = pixels[i + 3] / 255 * (l.mask ? l.mask[i / 4] / 255 : 1);
        const b = output[i + 3] / 255;
        const combined = a + b * (1 - a);
        for (let c = 0; c < 3; c++) output[i + c] = combined ? Math.round((pixels[i + c] * a + output[i + c] * b * (1 - a)) / combined) : 0;
        output[i + 3] = Math.round(combined * 255);
      }
    }
    return output;
  }
  return { doc, original, events, buffers, makeLayer: layer, render: () => composite(doc.layers) };
}
const rect = { left: 2, top: 1, right: 6, bottom: 4, width: 4, height: 3 };
function patch(api, rgba, target = rect) {
  return { id: 'fixture', mode: 'inpaint', placementMode: 'direct-selection-patch',
    b64: png(api, target.width, target.height, rgba), format: 'png', placementRect: target, targetRect: target };
}
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
async function main() {
  await test('transparent setting can be enabled, disabled and reloaded', () => {
    const { context, api } = boot(); api.loadSettings();
    const checkbox = context.document.getElementById('transparentBgInput');
    checkbox.checked = true; api.saveSettings(); assert.equal(api.getSettings().background, 'transparent');
    checkbox.checked = false; api.saveSettings(); api.loadSettings(); assert.equal(api.getSettings().background, 'auto');
  });
  await test('premultiplied interpolation excludes hidden RGB and preserves opaque behavior', () => {
    const { api } = boot();
    for (const hidden of [[0,0,0,0], [0,255,255,0], [255,255,255,0]]) {
      const result = api.resizeRgbaBilinear(new Uint8Array([255,0,0,255, ...hidden]), 2,1,3,1);
      assert.deepEqual(Array.from(result.slice(4,8)), [255,0,0,128]);
      assert.deepEqual(Array.from(result.slice(8,12)), [0,0,0,0]);
    }
    const opaque = api.resizeRgbaBilinear(new Uint8Array([0,20,40,255, 100,120,140,255]),2,1,3,1);
    assert.deepEqual(Array.from(opaque.slice(4,8)), [50,70,90,255]);
  });
  await test('small reference upload preserves alpha color through actual PNG resizing', async () => {
    const { api } = boot();
    const image = png(api,2,1,new Uint8Array([255,0,0,255, 0,0,0,0]));
    const padded = await api.createPaddedScreenshotReferenceBase64(image);
    const d = await api.decodePngRgbaBase64(padded.b64);
    const offset = Math.floor(d.width/2)*4;
    assert.equal(d.rgba[offset],255); assert(d.rgba[offset+3]>0 && d.rgba[offset+3]<255);
  });
  await test('normalization preserves every source RGBA component, including semitransparency', async () => {
    const { api } = boot();
    const pixels = new Uint8Array([0,0,0,0, 255,80,20,128, 255,255,255,255, 30,60,90,64]);
    const normalized = await api.normalizeScreenshotReferenceResultBase64(png(api,2,2,pixels),{sourceWidth:2,sourceHeight:2});
    assert.deepEqual(Array.from((await api.decodePngRgbaBase64(normalized.b64)).rgba),Array.from(pixels));
  });
  await test('white artwork on transparency is content, not blank matte', async () => {
    const { api } = boot();
    const pixels = new Uint8Array(4 * 3 * 4); pixels.set([255,255,255,255], (1 * 4 + 2) * 4);
    const reference = await api.createPaddedScreenshotReferenceBase64(png(api,4,3,pixels));
    assert.deepEqual(plain(reference.crop.sourceContentBounds), {left:2,top:1,right:3,bottom:2,width:1,height:1});
    assert(reference.crop.sourceNonWhiteRatio > 0, 'Legacy content metric must count white Alpha artwork');
  });
  for (const background of [false,true]) {
    await test(`pixel-exact transparent replacement, original masks retained, background=${background}`, async () => {
      const { api } = boot(); const h = host(api,{background});
      const originalPixels = h.original.pixels.slice(); const originalMask = h.original.mask.slice();
      const pixels = solid(4,3,[0,0,0,0]); pixels.set([255,0,0,128],(1*4+1)*4); pixels.set([255,255,255,255],(2*4+2)*4);
      const result = await api.placeResultAsLayer(patch(api,pixels),rect,'test',null,{pixelExactSelectionPatch:true});
      assert.equal(result.layer.parent,null,'Result must be above, not inside, masked sources');
      assert.deepEqual(plain(result.expectedVisibleRect),{left:3,top:2,right:5,bottom:4,width:2,height:2});
      assert.equal(result.sourceGroup.blendMode,'passThrough');
      const visible = h.render();
      for(let y=0;y<h.doc.height;y++) for(let x=0;x<h.doc.width;x++) {
        const i=(y*h.doc.width+x)*4;
        const inside=x>=rect.left&&x<rect.right&&y>=rect.top&&y<rect.bottom;
        const expected=inside?pixels.slice(((y-rect.top)*4+x-rect.left)*4,((y-rect.top)*4+x-rect.left)*4+4):originalPixels.slice(i,i+4);
        assert.deepEqual(Array.from(visible.slice(i,i+4)),Array.from(expected),`Wrong composite at ${x},${y}`);
      }
      assert.deepEqual(h.original.pixels,originalPixels); assert.deepEqual(h.original.mask,originalMask);
      assert.equal(h.original.visible,!background);
      assert.deepEqual(h.events.filter(e=>e[0]==='history'),[['history','suspend'],['history',true]]);
      assert(h.buffers.every(b=>b.disposed));
    });
  }
  await test('multiple root layers, nested groups, hidden layers and existing masks stay intact outside selection',async()=>{
    const {api}=boot(); const h=host(api);
    const child=h.makeLayer('Nested pixels',{pixels:solid(9,7,[10,200,30,80])});
    const existingGroup=h.makeLayer('Existing group',{layers:[child],mask:new Uint8Array(63).fill(255)});child.parent=existingGroup;
    existingGroup.mask[0]=0;
    const hidden=h.makeLayer('Hidden pixels',{visible:false,pixels:solid(9,7,[255,0,255,255])});
    h.doc.layers.unshift(existingGroup,hidden);
    const before=h.render();const oldMask=existingGroup.mask.slice();
    await api.placeResultAsLayer(patch(api,new Uint8Array(48)),rect,'clear');
    const after=h.render();
    for(let y=0;y<7;y++)for(let x=0;x<9;x++){
      const i=(y*9+x)*4;const inside=x>=2&&x<6&&y>=1&&y<4;
      assert.deepEqual(Array.from(after.slice(i,i+4)),inside?[0,0,0,0]:Array.from(before.slice(i,i+4)));
    }
    assert.equal(child.parent,existingGroup);assert.equal(hidden.visible,false);assert.deepEqual(existingGroup.mask,oldMask);
  });
  await test('real-host Alpha verifier rejects old source bleed and accepts trimmed transparent bounds',async()=>{
    const {api}=boot();host(api);
    const pixels=new Uint8Array(48);pixels.set([255,0,0,128],(1*4+1)*4);
    const item=patch(api,pixels);let disposed=false;
    api.imaging.getPixels=async()=>({sourceBounds:{left:3,top:2},imageData:{width:1,height:1,components:4,
      getData:async()=>new Uint8Array([255,0,0,128]),dispose(){disposed=true;}}});
    assert.equal(await api.verifySelectionCompositeAlpha(item,rect),true);assert.equal(disposed,true);
    api.imaging.getPixels=async()=>({sourceBounds:{left:2,top:1},imageData:{width:4,height:3,components:3,
      getData:async()=>new Uint8Array(36).fill(255),dispose(){}}});
    assert.equal(await api.verifySelectionCompositeAlpha(item,rect),false,'Opaque source leakage must fail real-host diagnostics');
  });
  await test('fully transparent output deletes the selection rather than exposing old pixels', async () => {
    const { api }=boot(); const h=host(api);
    const result=await api.placeResultAsLayer(patch(api,new Uint8Array(48)),rect,'delete');
    assert.equal(result.expectedVisibleRect,null);
    assert.equal(h.render()[(rect.top*h.doc.width+rect.left)*4+3],0);
  });
  await test('opaque output uses exact coordinates without grouping or modifying originals', async () => {
    const {api}=boot(); const h=host(api);
    const item=patch(api,solid(4,3,[40,50,60,255]));
    await api.placeResultAsLayer(item,rect,'opaque');
    assert.equal(h.doc.layers.length,2); assert.equal(h.doc.layers[1],h.original);
    assert(!h.events.some(e=>e[0]==='mask'));
    assert.deepEqual(h.events.find(e=>e[0]==='pixels').slice(1,4),[{left:2,top:1},4,3]);
  });
  await test('a second transparent edit also removes pixels from the previous generated patch', async () => {
    const {api}=boot(); const h=host(api);
    await api.placeResultAsLayer(patch(api,solid(4,3,[255,0,0,128])),rect,'first');
    const second={left:3,top:2,right:4,bottom:3,width:1,height:1};
    await api.placeResultAsLayer(patch(api,new Uint8Array(4),second),second,'second');
    assert.equal(h.render()[(2*9+3)*4+3],0);
    assert.equal(h.render()[(1*9+2)*4+3],128);
  });
  for (const failAt of ['duplicate','createLayerGroup','putLayerMask','createPixelLayer','move','putPixels']) {
    await test('failure rolls back all source and placement changes: '+failAt,async()=>{
      const {api}=boot();const h=host(api,{background:true,failAt});const before=snapshot(h.doc);
      await assert.rejects(()=>api.placeResultAsLayer(patch(api,new Uint8Array(48)),rect,'fail'),new RegExp('injected:'+failAt));
      assert.equal(snapshot(h.doc),before);assert.deepEqual(h.events.at(-1),['history',false]);
      assert(h.buffers.every(b=>b.disposed));
    });
  }
  await test('cancellation rolls back the complete atomic edit',async()=>{
    const {api}=boot();const h=host(api,{background:true,cancelled:true});const before=snapshot(h.doc);
    await assert.rejects(()=>api.placeResultAsLayer(patch(api,new Uint8Array(48)),rect,'cancel'),/取消/);
    assert.equal(snapshot(h.doc),before);
  });
  await test('missing Imaging API fails closed before changing any document layers',async()=>{
    const {api}=boot();const h=host(api);const before=snapshot(h.doc);delete api.imaging.putPixels;
    await assert.rejects(()=>api.placeResultAsLayer(patch(api,new Uint8Array(48)),rect,'unsupported'),/未修改原图/);
    assert.equal(snapshot(h.doc),before);assert.equal(h.events.length,0);
  });
  await test('no history rollback capability means no source mutation', async () => {
    const {api}=boot(); const h=host(api); const before=snapshot(h.doc);
    api.core.executeAsModal=async fn=>fn({});
    await assert.rejects(()=>api.placeResultAsLayer(patch(api,new Uint8Array(48)),rect,'unsupported'),/未修改原图/);
    assert.equal(snapshot(h.doc),before); assert(h.buffers.every(b=>b.disposed));
  });
  for (const changed of ['document','canvas']) {
    await test('reject stale placement after asynchronous '+changed+' change',async()=>{
      const {api}=boot();const h=host(api);const before=snapshot(h.doc);
      const execute=api.core.executeAsModal;
      api.core.executeAsModal=async fn=>{
        if(changed==='document') api.app.activeDocument={...h.doc,id:100};
        else h.doc.width++;
        return execute(fn);
      };
      await assert.rejects(()=>api.placeResultAsLayer(patch(api,new Uint8Array(48)),rect,'stale'),/文档已切换|画布尺寸已改变/);
      assert.equal(snapshot(h.doc),before);assert.equal(h.events.length,0);
    });
  }
  await test('closed Photoshop never passes runtime audit from old init logs',()=>{
    const auditSource=fs.readFileSync(path.join(__dirname,'audit-plugin-state.js'),'utf8').replace(/\nmain\(\);\s*$/,'');
    const sandbox={require,__dirname,process:{env:{},argv:[]},Buffer,console};
    const result=vm.runInNewContext(auditSource+`
      readLatestPhotoshopUxpLog=()=>({found:true,text:'[2026-09-19_20-00-00] [OpenAI Photoshop Generator] init 0.1.313'});
      auditPhotoshopRuntime('0.1.313',false);
    `,sandbox);
    assert.equal(result.ok,false);assert.equal(result.needsRestart,false);
    assert.equal(result.lastInit.version,'0.1.313');assert.equal(result.expectedInitSeen,true);
  });
  await test('historical direct-selection-patch import also uses exact RGBA replacement',async()=>{
    const {api,context}=boot();const h=host(api);api.loadSettings();
    const item=patch(api,solid(4,3,[100,20,30,128]));
    api.state.results=[item];api.state.selectedId=item.id;
    await api.importSelected();
    assert(h.events.some(e=>e[0]==='pixels'),context.document.getElementById('statusBar').textContent);
    assert.equal(h.render()[(1*9+2)*4+3],128);
  });
  await test('both model tiers and transparent background survive real request construction (no transport)',async()=>{
    const {context}=boot();
    const captured=await vm.runInContext(`(async()=>{
      const captured=[];saveDebugJsonFile=async()=>{};
      sendResponsesJsonWithMainModelFallback=async(s,b)=>{captured.push(b('gpt-5.5'));return{json:{output:[{type:'image_generation_call',result:'offline'}]}}};
      const rgba=new Uint8Array([255,0,0,128]);const b64=bytesToBase64(encodePngRgba(1,1,rgba));
      for(const model of ['gpt-image-2.5-flare','gpt-image-2.5-sunburst']){
        const s={model,size:'auto',quality:'high',format:'png',background:'transparent'};
        await requestResponsesTextImageGeneration(s,'offline');
        await requestResponsesImageEditFallback(s,'offline',b64,null,{screenshotReferenceEdit:true});
      }return captured;
    })()`,context);
    assert.equal(captured.length,4);
    for(let i=0;i<4;i++){
      const tool=captured[i].tools[0];
      assert.equal(tool.model,i<2?'gpt-image-2.5-flare':'gpt-image-2.5-sunburst');
      assert.equal(tool.background,'transparent');assert.equal(tool.output_format,'png');
      assert(!tool.input_image_mask,'Screenshot is not an API mask');
    }
  });
  console.log(`NATIVE_TRANSPARENCY_OK tests=${passed}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});

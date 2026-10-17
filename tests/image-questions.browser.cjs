const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');let browser;
before(async()=>{browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});});
after(async()=>{await browser.close();});
const src=label=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="50"><text x="10" y="30">${label}</text></svg>`);
const image=label=>`<img src="${src(label)}" alt="${label==='D'?'E':label}.png">`;
const option=(letter,body)=>`<div class="answerBg" role="radio" aria-checked="false"><span class="num_option">${letter}</span><div class="answer_p">${body}</div></div>`;
const question=(stem=image('stem'),options=['A','B','C','D'].map(l=>option(l,image(l))).join(''))=>`<div class="questionLi" typename="单选题" id="image-q"><h3 class="mark_name">8. <span>(单选题)</span></h3><p class="stem">${stem}</p><div class="stem_answer">${options}</div></div>`;
const texts=['水从右向左渗透的是，M葡萄糖=180，M NaCl=58.5','5%葡萄糖 | 2% NaCl','0.050 mol/kg 尿素 | 0.050 mol/kg 蔗糖','0.050 mol/kg MgSO4 | 0.050 mol/kg CaCl2','0.050 mol/kg NaCl | 0.080 mol/kg 葡萄糖'];
async function fixture(body=question(),outputs=texts){
 const page=await browser.newPage();page.setDefaultTimeout(2500);
 await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8">'+body}));
 await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy');
 await page.evaluate(outputs=>{window.events=[];window.ocrTexts=outputs;window.calls=[];window.terminated=0;window.created=0;window.ocrCalls=0;window.ocrErrors=[];
  const values=new Map([['cx_pure_answer_config',JSON.stringify({aiApiKey:'local-image-test-credential'})]]);
  window.GM_getValue=(k,f)=>values.get(k)??f;window.GM_setValue=(k,v)=>values.set(k,v);window.GM_deleteValue=k=>values.delete(k);
  window.GM_xmlhttpRequest=req=>{calls.push(JSON.parse(req.data));req.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers:[window.answer||'D'],needs_review:false})}}]})});return{abort(){}};};
  window.Tesseract={createWorker:opts=>{created++;return{load:async()=>{events.push('load');if(window.holdLoad)await new Promise(r=>window.releaseLoad=r);},loadLanguage:async l=>events.push(l),initialize:async l=>events.push(l),setParameters:async()=>{},recognize:async()=>{ocrCalls++;if(window.holdOCR)await new Promise(r=>window.releaseOCR=r);if(window.failOCR)throw new Error('mock OCR failure');return{data:{text:ocrTexts.shift()||''}};},terminate:async()=>{terminated++;}};}};
  for(const q of document.querySelectorAll('.questionLi'))for(const node of q.querySelectorAll('[role=radio]'))node.addEventListener('click',()=>{q.querySelectorAll('[role=radio]').forEach(n=>n.setAttribute('aria-checked',String(n===node)));});
 },outputs);
 const filename=process.env.SCRIPT_UNDER_TEST||path.join(__dirname,'..','chaoxing-pure.user.js');
 let code=fs.readFileSync(filename,'utf8').replace(/const PRIVATE_DEFAULT_API_KEY = '[^']*';/,"const PRIVATE_DEFAULT_API_KEY = '';");
 code=code.replace('  initScript();','  window.m={Solver,AnswerModule,UIPanel,Logger};\n  initScript();');await page.addScriptTag({content:code});
 await page.frameLocator('#cx-helper-iframe').locator('#cx-panel').waitFor();return page;
}
test('image recognition: image-only options retain four physical slots',async()=>{const p=await fixture();try{assert.equal(await p.evaluate(()=>m.Solver._extractOptionPairs(document.querySelector('.questionLi')).length),4);}finally{await p.close();}});
test('image recognition: metadata-only heading triggers OCR for stem and every option',async()=>{const p=await fixture();try{const r=await p.evaluate(async()=>{const q=await m.Solver.recognize(document.querySelector('.questionLi'));return{question:q.question,options:q.options,created,ocrCalls,terminated};});assert.match(r.question,/NaCl=58.5/);assert.deepEqual(r.options,texts.slice(1));assert.equal(r.created,1);assert.equal(r.ocrCalls,10);assert.equal(r.terminated,1);}finally{await p.close();}});
test('image recognition: image answer D selects fourth DOM option despite filename E',async()=>{const p=await fixture();try{const r=await p.evaluate(async()=>{const run=m.AnswerModule._beginRun('homework');const ok=await m.AnswerModule._processOneQuestion(document.querySelector('.questionLi'),8,run);m.AnswerModule._finishRun(run);return{ok,selected:[...document.querySelectorAll('[role=radio]')].map(n=>n.getAttribute('aria-checked')),calls,terminated};});assert.equal(r.ok,true);assert.deepEqual(r.selected,['false','false','false','true']);assert.equal(r.calls.length,1);assert.match(r.calls[0].messages[0].content,/MgSO4/);assert.match(r.calls[0].messages[0].content,/0.080/);assert.equal(r.terminated,1);}finally{await p.close();}});
test('image recognition: text stem with picture options still recognizes all options',async()=>{const p=await fixture(question('下列哪些溶液渗透压相同'),texts.slice(1));try{const r=await p.evaluate(async()=>{const q=await m.Solver.recognize(document.querySelector('.questionLi'));return{q:q.question,options:q.options,ocrCalls};});assert.match(r.q,/渗透压/);assert.deepEqual(r.options,texts.slice(1));assert.equal(r.ocrCalls,8);}finally{await p.close();}});
test('image recognition: mixed inline formula keeps text and OCR in reading order',async()=>{const p=await fixture(question('溶质 '+image('formula')+' 的质量是多少？',['A','B','C','D'].map((l,i)=>option(l,String((i+1)*100))).join('')),['NaCl']);try{const r=await p.evaluate(async()=>{const q=await m.Solver.recognize(document.querySelector('.questionLi'));return{q:q.question,options:q.options,ocrCalls};});assert.match(r.q,/溶质\s+NaCl\s+的质量/);assert.deepEqual(r.options,['100','200','300','400']);assert.equal(r.ocrCalls,2);}finally{await p.close();}});
test('image recognition: one unreadable option never shifts choices or asks AI',async()=>{const p=await fixture(question(),[texts[0],texts[1],'',texts[3],texts[4]]);try{const r=await p.evaluate(async()=>{const run=m.AnswerModule._beginRun('homework');const ok=await m.AnswerModule._processOneQuestion(document.querySelector('.questionLi'),8,run);m.AnswerModule._finishRun(run);return{ok,requests:calls.length,terminated};});assert.deepEqual(r,{ok:false,requests:0,terminated:1});}finally{await p.close();}});
test('image recognition: manual stop terminates an engine still loading',async()=>{const p=await fixture();try{await p.evaluate(()=>{window.holdLoad=true;const run=m.AnswerModule._beginRun('homework');window.task=m.AnswerModule._processOneQuestion(document.querySelector('.questionLi'),8,run);});await p.waitForFunction(()=>created===1);const r=await p.evaluate(async()=>{m.AnswerModule.stopAnswering();const ok=await task;return{ok,requests:calls.length,terminated};});assert.deepEqual(r,{ok:false,requests:0,terminated:1});}finally{await p.close();}});
test('image recognition: image failures release worker and continue to next text question',async()=>{const body=question()+`<div class="questionLi" typename="单选题" id="text-q"><h3 class="mark_name">（单选题）正常题目</h3><label><input type="radio" name="q">A. 一</label><label><input type="radio" name="q">B. 二</label></div>`;const p=await fixture(body);try{const r=await p.evaluate(async()=>{window.failOCR=true;window.answer='B';m.AnswerModule._getQuestionDelay=async()=>0;await m.AnswerModule.startHomework();return{requests:calls.length,second:document.querySelectorAll('#text-q input')[1].checked,terminated};});assert.deepEqual(r,{requests:1,second:true,terminated:1});}finally{await p.close();}});
test('image recognition: replacing an option during OCR rejects stale bindings',async()=>{const p=await fixture();try{await p.evaluate(()=>{window.holdOCR=true;const run=m.AnswerModule._beginRun('homework');window.task=m.AnswerModule._processOneQuestion(document.querySelector('.questionLi'),8,run);});await p.waitForFunction(()=>!!window.releaseOCR);const r=await p.evaluate(async()=>{const old=document.querySelector('[role=radio]');old.replaceWith(old.cloneNode(true));window.holdOCR=false;releaseOCR();const ok=await task;m.AnswerModule.stopAnswering();return{ok,selected:document.querySelectorAll('[aria-checked=true]').length};});assert.deepEqual(r,{ok:false,selected:0});}finally{await p.close();}});
test('image recognition: image budget is distinct from ordinary text recognition',async()=>{const p=await fixture();try{const r=await p.evaluate(async()=>{const budgets=[];m.AnswerModule._withDeadline=async(p,ms)=>{budgets.push(ms);return await p;};const run=m.AnswerModule._beginRun('homework');await m.AnswerModule._processOneQuestion(document.querySelector('.questionLi'),8,run);m.AnswerModule._finishRun(run);return budgets;});assert.deepEqual(r,[120000]);}finally{await p.close();}});
for(const heading of ['metadata','meaningful'])test(`image recognition: changed ${heading} mixed stem rejects a pending AI answer`,async()=>{
 const body=question('原题文字 '+image('formula')+' 结尾').replace('(单选题)</span>',`(单选题)</span>${heading==='meaningful'?' 固定标题':''}`);
 const p=await fixture(body);try{
  await p.evaluate(()=>{m.AnswerModule._queryAnswer=()=>new Promise(r=>window.releaseAnswer=r);const run=m.AnswerModule._beginRun('homework');window.task=m.AnswerModule._processOneQuestion(document.querySelector('.questionLi'),8,run);});
  await p.waitForFunction(()=>!!window.releaseAnswer);
  const r=await p.evaluate(async()=>{document.querySelector('.stem').firstChild.nodeValue='已经换成另一道题 ';releaseAnswer({answers:['D']});const ok=await task;m.AnswerModule.stopAnswering();return{ok,selected:document.querySelectorAll('[aria-checked=true]').length};});
  assert.deepEqual(r,{ok:false,selected:0});
 }finally{await p.close();}
});
test('image recognition: judgment image choices map using recognized true and false',async()=>{
 const body=question(image('stem'),option('A',image('A'))+option('B',image('B'))).replace('typename="单选题"','typename="判断题"').replace('(单选题)','(判断题)');
 const p=await fixture(body,['判断这句话','对','错']);try{const r=await p.evaluate(async()=>{const el=document.querySelector('.questionLi'),run=m.AnswerModule._beginRun('homework');const data=await m.Solver.recognize(el,run);const ok=await m.AnswerModule._applyAnswer(data,el,'图片判断',{answers:['错']},run);m.AnswerModule._finishRun(run);return{ok,selected:[...el.querySelectorAll('[role=radio]')].map(n=>n.getAttribute('aria-checked'))};});assert.deepEqual(r,{ok:true,selected:['false','true']});}finally{await p.close();}
});
test('image recognition: a symbol review augments each same option without adding option slots',async()=>{
 const alternatives=['符号题干 58.5','5% glucose 2% NaCl','0.050 urea 0.050 sucrose','0.050 MgSO4 0.050 CaCl2','0.050 NaCl 0.080 glucose'];
 const p=await fixture(question(),[...texts,...alternatives]);try{const r=await p.evaluate(async()=>{const q=await m.Solver.recognize(document.querySelector('.questionLi'));return{question:q.question,options:q.options,created,terminated};});assert.equal(r.options.length,4);assert.match(r.options[0],/符号复核.*5%/s);assert.match(r.options[2],/CaCl2/);assert.equal(r.created,1);assert.equal(r.terminated,1);}finally{await p.close();}
});
test('image recognition: cross-origin pictures use cancellable image download without API authorization',async()=>{
 const p=await fixture();try{const r=await p.evaluate(async()=>{
  const q=document.querySelector('.questionLi');q.querySelector('img').src='https://p.ananas.chaoxing.com/picture.png';
  const original=GM_xmlhttpRequest;window.downloads=[];
  GM_xmlhttpRequest=req=>{if(req.method==='GET'){downloads.push({url:req.url,hasAuth:!!req.headers?.Authorization});const data=new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="60"><text y="25">image</text></svg>');req.onload({status:200,response:data.buffer,responseHeaders:'Content-Type: image/svg+xml'});return{abort(){}};}return original(req);};
  const result=await m.Solver.recognize(q);return{ok:!!result,downloads,terminated};
 });assert.equal(r.ok,true);assert.deepEqual(r.downloads,[{url:'https://p.ananas.chaoxing.com/picture.png',hasAuth:false}]);assert.equal(r.terminated,1);}finally{await p.close();}
});
test('image recognition: manual stop aborts a pending image download and terminates OCR',async()=>{
 const p=await fixture();try{
  await p.evaluate(()=>{document.querySelector('.questionLi img').src='https://p.ananas.chaoxing.com/pending.png';window.imageDownloads=0;window.imageAborts=0;GM_xmlhttpRequest=req=>{if(req.method==='GET')imageDownloads++;return{abort(){imageAborts++;}};};const run=m.AnswerModule._beginRun('homework');window.task=m.AnswerModule._processOneQuestion(document.querySelector('.questionLi'),8,run);});
  await p.waitForFunction(()=>imageDownloads===1);const r=await p.evaluate(async()=>{m.AnswerModule.stopAnswering();const ok=await task;return{ok,imageAborts,terminated};});assert.deepEqual(r,{ok:false,imageAborts:1,terminated:1});
 }finally{await p.close();}
});
test('image recognition: own deadline releases loading worker and run resources',async()=>{
 const p=await fixture();try{
  await p.evaluate(()=>{const timeout=setTimeout;window.setTimeout=(fn,ms,...args)=>{if(ms===110000)window.imageDeadline=fn;return timeout(fn,ms,...args);};window.holdLoad=true;window.run=m.AnswerModule._beginRun('homework');window.task=m.AnswerModule._processOneQuestion(document.querySelector('.questionLi'),8,run);});
  await p.waitForFunction(()=>created===1&&!!window.imageDeadline);const r=await p.evaluate(async()=>{imageDeadline();const ok=await task;const result={ok,requests:run.requests.size,waits:run.waits.size,terminated};m.AnswerModule._finishRun(run);return result;});assert.deepEqual(r,{ok:false,requests:0,waits:0,terminated:1});
 }finally{await p.close();}
});
test('image recognition: replacing a same-source stem image during OCR cannot silently drop its formula',async()=>{
 const p=await fixture(question('计算 '+image('formula')+' 的值'));try{
  await p.evaluate(()=>{window.holdOCR=true;const run=m.AnswerModule._beginRun('homework');window.task=m.AnswerModule._processOneQuestion(document.querySelector('.questionLi'),8,run);});
  await p.waitForFunction(()=>!!window.releaseOCR);const r=await p.evaluate(async()=>{const image=document.querySelector('.stem img');image.replaceWith(image.cloneNode(true));window.holdOCR=false;releaseOCR();const ok=await task;m.AnswerModule.stopAnswering();return{ok,requests:calls.length,selected:document.querySelectorAll('[aria-checked=true]').length};});assert.deepEqual(r,{ok:false,requests:0,selected:0});
 }finally{await p.close();}
});

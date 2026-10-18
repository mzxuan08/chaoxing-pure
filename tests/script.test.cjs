const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const filename = process.env.SCRIPT_UNDER_TEST || require('node:path').join(__dirname, '..', 'chaoxing-pure.user.js');
const source = fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
test('core connection metadata retains AI and font request permissions',()=>{
  const connect=[...source.matchAll(/^\/\/ @connect\s+(\S+)\s*$/gm)].map(m=>m[1]);
  for(const domain of ['chaoxing.com','xuexitong.com','api.deepseek.com','chizhu-dl.github.io'])assert.ok(connect.includes(domain),`missing core connection permission: ${domain}`);
});
function setup(saved = {}, responses = [], worker = false) {
  if (!('cx_pure_answer_config' in saved) && !('cx_answer_config' in saved)) saved = { ...saved, cx_pure_answer_config: { aiApiKey: 'local-test-credential-only' } };
  const values = new Map(Object.entries(saved).map(([k,v]) => [k, JSON.stringify(v)]));
  const local = new Map();
  const requests = [], messages = [], menus = [];
  const document = { querySelector: () => null, querySelectorAll: () => [], title: '学习通', body: {} };
  const window = { document }; window.top = window; window.self = window;
  const ctx = { window, document, location: { href: 'https://mooc1.chaoxing.com/mycourse/studentstudy', hostname: 'mooc1.chaoxing.com' }, navigator: { userAgent: 'test' },
    prompt: () => null, GM_registerMenuCommand: (label, handler) => menus.push({ label, handler }),
    URL, console: { log: (...m) => messages.push(m.join(' ')), error: (...m) => messages.push(m.join(' ')) },
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: { getItem: k => local.get(k) ?? null, setItem: (k,v) => local.set(k,v), removeItem: k => local.delete(k) },
    GM_getValue: (k,f) => values.get(k) ?? f, GM_setValue: (k,v) => values.set(k,v), GM_deleteValue: k => values.delete(k),
    CryptoJS: { enc: { Utf8: { parse: s => s } } },
    GM_xmlhttpRequest: req => { requests.push(req); const response = responses.shift() || { status: 200, responseText: JSON.stringify({ choices: [{ message: { content: 'A' } }] }) }; if (response.error) req.onerror(); else if (response.timeout) req.ontimeout(); else req.onload(response); }
  };
  const marker = source.lastIndexOf('  initScript();');
  assert.ok(marker > 0, 'script entry exists');
  let exposed = source.slice(0, marker) + '  globalThis.modules = { ConfigStore, UIPanel, AnswerModule, VideoModule, Solver, Logger, FrameMediaBridge };' + source.slice(marker + '  initScript();'.length);
  if (worker) exposed = exposed.replace(/const _isMediaWorkerFrame = [^\n]+;/, 'const _isMediaWorkerFrame = true;');
  vm.runInNewContext(exposed, ctx, { filename: 'script-under-test.js' });
  return { ...ctx.modules, ctx, values, requests, messages, menus };
}

for (const superseded of [false,true]) test(`worker audit: ended report retires only its own playback token; superseded=${superseded}`,()=>{
  const {FrameMediaBridge:bridge,ctx}=setup({},[],true);
  const sent=[];let tick;
  ctx.setTimeout=fn=>{tick=fn;return 1;};
  bridge._workerSession='session';bridge._workerChapterEpoch=1;bridge._workerPlayToken='old-play';
  bridge._workerSnapshot=()=>({state:'ready',hasVideo:true,hasMore:true});
  bridge._workerPost=(type,payload,hello,context)=>sent.push({type,token:context?.playToken??bridge._workerPlayToken});
  bridge.notifyWorkerEnded();if(superseded)bridge._workerPlayToken='new-play';tick();bridge.reportWorkerState(true);
  assert.deepEqual(sent,[{type:'EVENT',token:'old-play'},{type:'STATE',token:superseded?'new-play':''}]);
});

for (const hasMore of [false,true]) test(`worker audit: source failure preserves reload authority or releases next video; hasMore=${hasMore}`,()=>{
  const {FrameMediaBridge:bridge}=setup({},[],true);
  bridge._workerPlayToken='failed-play';bridge._workerSnapshot=()=>({state:hasMore?'ready':'finished',hasMore});
  let eventToken;bridge._workerPost=()=>eventToken=bridge._workerPlayToken;
  bridge.notifyWorkerSourceExhausted('mock source');
  assert.equal(eventToken,'failed-play');assert.equal(bridge._workerPlayToken,hasMore?'':'failed-play');
});
test('no advertising, bank service, or unlock UI', () => {
  const { UIPanel } = setup();
  assert.equal(/qsy\.iano\.cn|C919irt|扫码|验证码|解锁|积分|付费|激活码/.test(UIPanel._buildHTML()), false);
  assert.equal(/qsy\.iano\.cn|AccessGuard|askFreeBank|askPaidBank|aiUnlock|verifyProof|35000/.test(source), false);
});
test('legacy settings migrate to DeepSeek-only mode', () => {
  const { ConfigStore } = setup({ cx_answer_config: { mode: 'paid', aiProvider: 'deepseek', aiApiKey: 'test-only-key', activationCode: 'old' }, cx_video_config: { playbackRate: 1.5, quizMode: 'free', autoAnswerQuiz: false } });
  assert.equal(ConfigStore.getAnswerConfig().mode, 'ai');
  assert.equal(ConfigStore.getAIProvider(), 'deepseek');
  assert.equal(ConfigStore.getAnswerConfig().aiApiKey, 'test-only-key');
  assert.equal(ConfigStore.getVideoConfig().quizMode, 'ai');
  assert.equal(ConfigStore.getVideoConfig().playbackRate, 1.5);
  assert.equal(ConfigStore.getVideoConfig().autoAnswerQuiz, false);
  assert.equal('activationCode' in ConfigStore.getAnswerConfig(), false);
});
test('public release has no embedded key and never exposes locally configured key in HTML', () => {
  const { ConfigStore, UIPanel } = setup();
  const key = ConfigStore.getAnswerConfig().aiApiKey;
  assert.equal(/const PRIVATE_DEFAULT_API_KEY = '';/.test(source), true);
  assert.ok(key.length > 20);
  assert.equal(UIPanel._buildHTML().includes(key), false);
});
test('question interval varies between 0.2 and 0.4 seconds without unlock dependency', async () => {
  const { AnswerModule, requests } = setup();
  AnswerModule._mode = 'ai';
  const delays = await Promise.all(Array.from({ length: 20 }, () => AnswerModule._getQuestionDelay()));
  assert.ok(delays.every(delay => delay >= 200 && delay <= 400));
  assert.ok(new Set(delays).size > 1, 'interval is randomized');
  assert.equal(requests.length, 0);
});

function transitionFixture(config={},remote=false,nextVideo=null){
  const env=setup();const {VideoModule:video,FrameMediaBridge:bridge,ConfigStore,ctx}=env;
  ConfigStore.getVideoConfig=()=>({autoAdvance:true,autoAnswerQuiz:true,...config});
  video._playing=true;video._playbackEpoch=1;video._getVideoSourceKey=()=> 'test-video';video._findVideoElement=()=>nextVideo;
  bridge.playNextWorker=()=>false;const timers=[],actions=[];
  ctx.setTimeout=(fn,ms)=>{const t={fn,ms};timers.push(t);return t;};ctx.clearTimeout=()=>{};
  video._checkAndHandleChapterQuiz=()=>actions.push('quiz');video.advanceToNextChapter=()=>actions.push('next');video._tryPlayVideo=()=>actions.push('play');
  let ended;const element={dataset:{},addEventListener:(name,fn)=>{if(name==='ended')ended=fn;}};
  const finish=()=>{if(remote)video._handleRemoteVideoEnded();else{video._bindVideoEvents(element);ended();}};
  return{...env,timers,actions,finish,element};
}
for(const remote of [false,true])for(const quiz of [false,true])test(`fast transition: remote=${remote} quiz=${quiz} checks next content after 200ms`,()=>{
  const {timers,actions,finish}=transitionFixture({autoAnswerQuiz:quiz},remote);finish();assert.equal(timers.length,1);assert.equal(timers[0].ms,200);timers.shift().fn();assert.deepEqual(actions,[quiz?'quiz':'next']);
});
test('fast transition: another local video scrolls and starts within 300ms of fixed waits',()=>{
  let scrolled=false;const next={scrollIntoView:()=>{scrolled=true;}};const {timers,actions,finish}=transitionFixture({},false,next);finish();assert.equal(timers[0].ms,100);timers.shift().fn();assert.equal(scrolled,true);assert.equal(timers[0].ms,200);timers.shift().fn();assert.deepEqual(actions,['play']);
});
for(const remote of [false,true])test(`fast transition: stopped playback never advances remote=${remote}`,()=>{
  const {VideoModule,timers,actions,finish}=transitionFixture({},remote);finish();VideoModule._playing=false;VideoModule._playbackEpoch++;timers.shift().fn();assert.deepEqual(actions,[]);
});
test('fast transition: disabled automatic advance schedules nothing',()=>{
  const {timers,actions,finish}=transitionFixture({autoAdvance:false});finish();assert.equal(timers.length,0);assert.deepEqual(actions,[]);
});
test('fast transition: ready cross-frame worker starts without an added chapter delay',()=>{
  const {FrameMediaBridge,timers,finish}=transitionFixture({},true);let starts=0;FrameMediaBridge.playNextWorker=()=>{starts++;return true;};finish();assert.equal(starts,1);assert.equal(timers.length,0);
});
test('answers go directly to official DeepSeek Flash API', async () => {
  const { AnswerModule, Solver, requests, messages } = setup({ cx_answer_config: { aiProvider: 'deepseek', aiApiKey: 'test-only-key' } });
  const result = await AnswerModule._queryAnswer('test question', ['one', 'two'], Solver.TYPE_SINGLE);
  assert.equal(Array.from(result.answers).join(','), 'A');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(requests[0].headers.Authorization, 'Bearer test-only-key');
  const body = JSON.parse(requests[0].data);
  assert.equal(body.model, 'deepseek-flash');
  assert.equal(body.thinking.type, 'enabled');
  assert.equal(body.reasoning_effort, 'high');
  assert.ok(body.max_tokens >= 8192);
  assert.equal(body.response_format.type, 'json_object');
  assert.equal(body.stream, false);
  assert.equal(messages.join('\n').includes('test-only-key'), false);
});

test('accuracy: prompt explicitly handles negation, all multiple choices and structured output',()=>{
  const {AnswerModule,Solver}=setup();const prompt=AnswerModule._buildAIPrompt('以下不正确的是',['甲','乙'],Solver.TYPE_MULTI);
  assert.match(prompt,/JSON/i);assert.match(prompt,/否定/);assert.match(prompt,/逐项/);assert.match(prompt,/needs_review/);
});

test('accuracy: JSON single choice is parsed and reasoning is not used as the final answer',async()=>{
  const {AnswerModule,Solver,requests}=setup({},[{status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{reasoning_content:'A is wrong',content:JSON.stringify({answers:['B'],needs_review:false})}}]})}]);
  const result=await AnswerModule.askAI('question',['甲','乙'],Solver.TYPE_SINGLE);assert.deepEqual(Array.from(result.answers),['B']);assert.equal(requests.length,1);
});

test('accuracy: inconsistent multiple-choice checks trigger at most one review',async()=>{
  const contents=[{answers:['A'],checks:[{option:'A',correct:true},{option:'B',correct:true}],needs_review:false},{answers:['A','B'],checks:[{option:'A',correct:true},{option:'B',correct:true}],needs_review:false}];
  const {AnswerModule,Solver,requests}=setup({},contents.map(x=>({status:200,responseText:JSON.stringify({choices:[{message:{content:JSON.stringify(x)}}]})})));
  const result=await AnswerModule.askAI('question',['甲','乙'],Solver.TYPE_MULTI);assert.deepEqual(Array.from(result.answers),['A','B']);assert.equal(requests.length,2);
});

test('accuracy: still uncertain after review skips without endless requests',async()=>{
  const response={status:200,responseText:JSON.stringify({choices:[{message:{content:JSON.stringify({answers:['A'],needs_review:true})}}]})};
  const {AnswerModule,Solver,requests}=setup({},[response,response]);const result=await AnswerModule.askAI('question',['甲'],Solver.TYPE_SINGLE);assert.equal(result.answers.length,0);assert.equal(requests.length,2);
});

test('accuracy: incomplete truncated response is never applied',async()=>{
  const response={status:200,responseText:JSON.stringify({choices:[{finish_reason:'length',message:{content:'A'}}]})};
  const {AnswerModule,Solver,requests}=setup({},[response,response]);const result=await AnswerModule.askAI('question',['甲'],Solver.TYPE_SINGLE);assert.equal(result.answers.length,0);assert.equal(requests.length,2);
});

test('accuracy: malformed uncertainty flag triggers review rather than accepting an answer',async()=>{
  const response={status:200,responseText:JSON.stringify({choices:[{message:{content:JSON.stringify({answers:['A'],needs_review:'true'})}}]})};
  const {AnswerModule,Solver,requests}=setup({},[response,response]);const result=await AnswerModule.askAI('question',['甲'],Solver.TYPE_SINGLE);assert.equal(result.answers.length,0);assert.equal(requests.length,2);
});
test('empty fill answer retries once with a stronger prompt', async () => {
  const responses = ['答案：', 'one||two'].map(content => ({ status: 200, responseText: JSON.stringify({ choices: [{ message: { content } }] }) }));
  const { AnswerModule, Solver, requests } = setup({}, responses);
  const result = await AnswerModule.askAI('() and ()', [], Solver.TYPE_FILL);
  assert.equal(Array.from(result.answers).join(','), 'one,two');
  assert.equal(requests.length, 2);
});
for (const status of [401, 402, 429, 500]) test(`HTTP ${status} produces no answer even with malformed success content`, async () => {
  const { AnswerModule, Solver, ctx } = setup({}, Array.from({length:3},()=>({ status, responseText: JSON.stringify({ choices: [{ message: { content: 'A' } }] }) })));
  ctx.setTimeout=(fn,ms)=>setTimeout(fn,ms<10000?1:ms);
  const result = await AnswerModule.askAI('question', ['a'], Solver.TYPE_SINGLE);
  assert.equal(result.answers.length, 0);
});
for (const response of [{ error: true }, { timeout: true }, { status: 200, responseText: 'invalid' }]) test('network or parsing error resolves safely', async () => {
  const { AnswerModule, Solver, ctx } = setup({}, [response,response,response]);
  ctx.setTimeout=(fn,ms)=>setTimeout(fn,ms<10000?1:ms);
  const result = await AnswerModule.askAI('question', ['a'], Solver.TYPE_SINGLE);
  assert.equal(result.answers.length, 0);
});
test('AI-only mode does not repeat failed requests via bank fallback', async () => {
  const { AnswerModule, Solver, requests } = setup({}, [{ status: 401, responseText: '{}' }]);
  const qData = { question: 'question', options: ['a'], type: Solver.TYPE_SINGLE };
  const result = await AnswerModule._queryAnswer(qData.question, qData.options, qData.type);
  const applied = await AnswerModule._applyAnswer(qData, {}, 'test question', result);
  assert.equal(applied, false);
  assert.equal(requests.length, 1);
});
const responseFor = content => ({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:typeof content==='string'?content:JSON.stringify(content)}}]})});
for (const failure of [{status:429,responseText:'{}'}, {status:503,responseText:'{}'}, {error:true}, {timeout:true}]) test(`answer recovery: transient ${JSON.stringify(failure)} retries once`,async()=>{
  const {AnswerModule,Solver,ctx,requests}=setup({},[failure,responseFor({answers:['B'],needs_review:false})]);
  ctx.setTimeout=(fn,ms)=>setTimeout(fn,ms<10000?1:ms);
  const result=await AnswerModule.askAI('question',['甲','乙'],Solver.TYPE_SINGLE);
  assert.deepEqual(Array.from(result.answers),['B']);assert.equal(requests.length,2);
});
test('answer recovery: invalid API JSON receives one content repair',async()=>{
  const {AnswerModule,Solver,requests}=setup({},[{status:200,responseText:'broken'},responseFor({answers:['A'],needs_review:false})]);
  const result=await AnswerModule.askAI('question',['甲'],Solver.TYPE_SINGLE);
  assert.deepEqual(Array.from(result.answers),['A']);assert.equal(requests.length,2);
});
test('answer recovery: transport recovery and answer review share a three-request cap',async()=>{
  const {AnswerModule,Solver,ctx,requests}=setup({},[{status:503,responseText:'{}'},responseFor({answers:[],needs_review:true}),responseFor({answers:['A'],needs_review:false})]);
  ctx.setTimeout=(fn,ms)=>setTimeout(fn,ms<10000?1:ms);
  const result=await AnswerModule.askAI('question',['甲'],Solver.TYPE_SINGLE);
  assert.deepEqual(Array.from(result.answers),['A']);assert.equal(requests.length,3);
});
test('answer recovery: repeated transient errors terminate after one retry',async()=>{
  const failure={status:503,responseText:'{}'};
  const {AnswerModule,Solver,ctx,requests}=setup({},[failure,failure]);
  ctx.setTimeout=(fn,ms)=>setTimeout(fn,ms<10000?1:ms);
  const result=await AnswerModule.askAI('question',['甲'],Solver.TYPE_SINGLE);
  assert.equal(result.answers.length,0);assert.equal(requests.length,2);
});
test('answer recovery: Retry-After is respected and excessive delay skips safely',async()=>{
  const {AnswerModule,Solver,ctx,requests}=setup({},[{status:429,responseHeaders:'Retry-After: 4\r\n',responseText:'{}'},responseFor('A')]);
  const delays=[];ctx.setTimeout=(fn,ms)=>{delays.push(ms);return setTimeout(fn,ms<10000?1:ms);};
  assert.equal((await AnswerModule.askAI('q',['甲'],Solver.TYPE_SINGLE)).answers[0],'A');
  assert.ok(delays.some(ms=>ms>=4000&&ms<10000));assert.equal(requests.length,2);
  const other=setup({},[{status:429,responseHeaders:'Retry-After: 120\r\n',responseText:'{}'}]);
  assert.equal((await other.AnswerModule.askAI('q',['甲'],other.Solver.TYPE_SINGLE)).answers.length,0);assert.equal(other.requests.length,1);
});
test('answer recovery: stop cancels a queued retry before any later request',async()=>{
  const {AnswerModule,Solver,ctx,requests}=setup({},[{status:503,responseText:'{}'},responseFor('A')]);
  let retry;ctx.setTimeout=(fn,ms)=>ms<10000?(retry=fn,101):setTimeout(fn,ms);ctx.clearTimeout=id=>{if(id!==101)clearTimeout(id);};
  const run=AnswerModule._beginRun('homework');const task=AnswerModule.askAI('q',['甲'],Solver.TYPE_SINGLE,run);
  AnswerModule._cancelRun(run);if(retry)retry();const result=await task;
  assert.equal(result.cancelled,true);assert.equal(requests.length,1);
});
for (const answer of ['ｂ','（Ｂ）','B.','选项 B','乙']) test(`answer recovery: exact choice notation ${answer} is accepted`,()=>{
  const {AnswerModule,Solver}=setup();
  assert.deepEqual(Array.from(AnswerModule._validateAIResponse(JSON.stringify({answers:[answer],needs_review:false}),Solver.TYPE_SINGLE,['甲','乙'])),['B']);
});
test('answer recovery: unique exact option text and lowercase checks keep multiple-choice consistency',()=>{
  const {AnswerModule,Solver}=setup();
  const response={answers:['甲','乙'],checks:[{option:'ａ',correct:true},{option:'b',correct:true}],needs_review:false};
  assert.deepEqual(Array.from(AnswerModule._validateAIResponse(JSON.stringify(response),Solver.TYPE_MULTI,['甲','乙'])),['A','B']);
});
test('answer recovery: ambiguity uncertainty and contradictory checks remain rejected',()=>{
  const {AnswerModule,Solver}=setup();
  for(const data of [{answers:['同文'],needs_review:false},{answers:['A'],needs_review:true},{answers:['A 或 B'],needs_review:false}])assert.equal(AnswerModule._validateAIResponse(JSON.stringify(data),Solver.TYPE_SINGLE,['同文','同文']).length,0);
  assert.equal(AnswerModule._validateAIResponse(JSON.stringify({answers:['A'],checks:[{option:'a',correct:false},{option:'b',correct:true}],needs_review:false}),Solver.TYPE_MULTI,['甲','乙']).length,0);
});
test('answer recovery: unresolved uncertainty returns a distinct reason for the question log',async()=>{
  const response=responseFor({answers:[],needs_review:true});const {AnswerModule,Solver}=setup({},[response,response]);
  const result=await AnswerModule.askAI('q',['甲'],Solver.TYPE_SINGLE);assert.equal(result.reason,'AI 复核后仍无法确定');
});

test('answer recovery: slow first answer still leaves a full request budget for review',async()=>{
  const {AnswerModule,Solver,ctx,requests}=setup();let now=1000;
  ctx.Date=class extends Date{static now(){return now;}};
  ctx.GM_xmlhttpRequest=req=>{requests.push(req);return{abort(){}};};
  const run=AnswerModule._beginRun('homework');const task=AnswerModule.askAI('q',['甲'],Solver.TYPE_SINGLE,run);
  now+=89000;requests[0].onload(responseFor({answers:[],needs_review:true}));
  assert.equal(requests.length,2);assert.equal(requests[1].timeout,90000);
  requests[1].onload(responseFor({answers:['A'],needs_review:false}));assert.equal((await task).answers[0],'A');
});
test('answer recovery: duplicate callback from a failed request cannot overwrite retry result',async()=>{
  const {AnswerModule,Solver,ctx,requests}=setup();let queued;
  ctx.setTimeout=(fn,ms)=>ms<10000?(queued=fn,101):setTimeout(fn,ms);ctx.clearTimeout=id=>{if(id!==101)clearTimeout(id);};
  ctx.GM_xmlhttpRequest=req=>{requests.push(req);return{abort(){}};};
  const task=AnswerModule.askAI('q',['甲','乙'],Solver.TYPE_SINGLE);
  requests[0].onload({status:503,responseText:'{}'});queued();
  requests[0].onload(responseFor('A'));requests[1].onload(responseFor('B'));
  assert.equal((await task).answers[0],'B');assert.equal(requests.length,2);
});

test('answer recovery: malformed multiple-choice field is rejected without throwing',()=>{
  const {AnswerModule,Solver}=setup();
  const data={answers:['A'],needs_review:false,checks:[{option:{toString:null},correct:true}]};
  assert.equal(AnswerModule._validateAIResponse(JSON.stringify(data),Solver.TYPE_MULTI,['甲']).length,0);
});
test('answer recovery: malformed multiple-choice field receives repair without hanging',async()=>{
  const {AnswerModule,Solver,ctx,requests}=setup();
  ctx.GM_xmlhttpRequest=req=>{requests.push(req);return{abort(){}};};
  const run=AnswerModule._beginRun('homework');const task=AnswerModule.askAI('q',['甲'],Solver.TYPE_MULTI,run);
  try{
    assert.doesNotThrow(()=>requests[0].onload(responseFor({answers:['A'],needs_review:false,checks:[{option:{toString:null},correct:true}]})));
    assert.equal(requests.length,2);
    requests[1].onload(responseFor({answers:['A'],needs_review:false,checks:[{option:'A',correct:true}]}));
    assert.equal((await task).answers[0],'A');
  }finally{AnswerModule._cancelRun(run);}
});

test('answer recovery: judgement and fill prompts tolerate absent options',()=>{
  const {AnswerModule,Solver}=setup();
  for(const type of [Solver.TYPE_JUDGE,Solver.TYPE_FILL])assert.doesNotThrow(()=>JSON.parse(AnswerModule._buildAIPrompt('题目',undefined,type).split('题目数据：\n')[1]));
});

test('chapter quiz availability checks the local key only', async () => {
  const { VideoModule, requests } = setup();
  assert.equal(await VideoModule._canUseQuizMode('ai', 'test'), true);
  assert.equal(requests.length, 0);
});
test('UI exposes only the pure edition name and no AI configuration controls', () => {
  const { UIPanel } = setup();
  const html = UIPanel._buildHTML();
  assert.equal(/cx-ai-apikey|cx-btn-save-aikey|cx-ai-provider-info|cx-video-quiz-mode-inline|cx-cfg-quiz-mode|DeepSeek/.test(html), false);
  assert.ok(html.includes('纯净版'));
  assert.ok(html.includes('cx-header-title'));
  assert.ok(/^\/\/ @name\s+纯净版$/m.test(source));
});
for (const [input, kind, expected] of [
  ['Cannot determine', 'TYPE_SINGLE', []],
  ['I cannot answer', 'TYPE_SINGLE', []],
  ['A or B', 'TYPE_SINGLE', []],
  ['无法确定', 'TYPE_MULTI', []],
  ['Cannot determine', 'TYPE_MULTI', []],
  ['不正确', 'TYPE_JUDGE', ['错']],
  ['不对', 'TYPE_JUDGE', ['错']],
  ['not true', 'TYPE_JUDGE', ['错']],
  ['not correct', 'TYPE_JUDGE', ['错']],
  ['正确', 'TYPE_JUDGE', ['对']],
  ['答案：B', 'TYPE_SINGLE', ['B']],
  ['A||C', 'TYPE_MULTI', ['A', 'C']],
  ['ACD', 'TYPE_MULTI', ['A', 'C', 'D']],
  ['A||Cannot determine', 'TYPE_MULTI', []],
  ['对或错', 'TYPE_JUDGE', []],
  ['无法确定，但可能正确', 'TYPE_JUDGE', []],
  ['[0,"右"]', 'TYPE_FILL', ['0', '右']],
  ['["左",""]', 'TYPE_FILL', []]
]) test(`AI parser handles ${kind}: ${input}`, () => {
  const { AnswerModule, Solver } = setup();
  assert.deepEqual(Array.from(AnswerModule._parseAIAnswer(input, Solver[kind])), expected);
});


test('public release: fresh configuration has no credential and makes no request', async () => {
  const {ConfigStore,AnswerModule,Solver,requests}=setup({cx_pure_answer_config:{aiApiKey:''}});
  assert.equal(ConfigStore.getAnswerConfig().aiApiKey === '',true);
  const result=await AnswerModule.askAI('q',['A'],Solver.TYPE_SINGLE);
  assert.equal(result.answers.length,0);assert.equal(requests.length,0);
});
test('public release: local menu stores a supplied key without logging it',()=>{
  const {ctx,menus,ConfigStore,Logger,UIPanel}=setup({cx_pure_answer_config:{aiApiKey:''}});
  const value='local-test-credential-for-menu';ctx.prompt=()=>value;
  assert.equal(menus.length,1);assert.match(menus[0].label,/API Key/);menus[0].handler();
  assert.equal(ConfigStore.getAnswerConfig().aiApiKey,value);
  assert.equal(JSON.stringify(Logger.getEntries()).includes(value),false);assert.equal(UIPanel._buildHTML().includes(value),false);
});
for(const value of [null,'','  ','short','invalid key with spaces'])test(`public release: cancelled or invalid local configuration is unchanged (${value})`,()=>{
  const {ctx,menus,ConfigStore}=setup();const previous=ConfigStore.getAnswerConfig().aiApiKey;ctx.prompt=()=>value;
  assert.equal(menus.length,1);menus[0].handler();assert.equal(ConfigStore.getAnswerConfig().aiApiKey,previous);
});

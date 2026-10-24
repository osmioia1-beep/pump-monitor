const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const snapshotTime=Date.parse('2026-10-24T11:00:00Z');
const rows=[
    {event:'start',ts:'2026-10-20T07:00:00Z',source_ip:'test'},
    {event:'stop',ts:'2026-10-20T07:01:00Z',source_ip:'test'},
    {event:'start',ts:'2026-10-23T22:50:00Z',source_ip:'test'},
    {event:'stop',ts:'2026-10-23T23:10:00Z',source_ip:'test'},
    {event:'stop',ts:'2026-10-23T23:20:00Z',source_ip:'<img src=x onerror="window.injected=true">'}
];
class Element {
    constructor(tag='div'){this.tag=tag;this.children=[];this.handlers={};this.hidden=false;this.value='';this.text='';}
    set textContent(value){this.text=String(value);this.children=[];}
    get textContent(){return this.text+this.children.map(c=>c.textContent).join('');}
    set innerHTML(value){throw new Error('Event data must not be inserted as HTML');}
    appendChild(child){if(child.tag==='fragment')this.children.push(...child.children);else this.children.push(child);return child;}
    replaceChildren(...children){this.children=[];this.text='';children.forEach(c=>this.appendChild(c));}
    addEventListener(event,handler){this.handlers[event]=handler;}
}
async function setup(){
    const elements={};
    for(const match of html.matchAll(/id="([^"]+)"/g))elements[match[1]]=new Element();
    const statIds=[...html.matchAll(/class="stat-value" id="([^"]+)"/g)].map(m=>m[1]);
    elements.limitInput.value='50';
    const state={calls:0,fail:false,rows};
    const document={getElementById(id){if(!elements[id])throw Error('Missing HTML element: '+id);return elements[id];},
        querySelectorAll(selector){assert.equal(selector,'.stat-value');return statIds.map(id=>elements[id]);},
        createElement:tag=>new Element(tag),createDocumentFragment:()=>new Element('fragment')};
    class FixedDate extends Date {static now(){return snapshotTime;}}
    const context=vm.createContext({document,Date:FixedDate,URL,AbortSignal,fetch:async(url,init)=>{
        state.calls++;assert.equal(init.method,'GET');
        if(state.fail) return {ok:false,status:500,statusText:'Failure'};
        const offset=Number(new URL(url).searchParams.get('offset'));
        const page=state.rows.slice(offset,offset+2);
        return {ok:true,headers:{get:()=>page.length?`${offset}-${offset+page.length-1}/${state.rows.length}`:'*/0'},json:async()=>page};
    }});
    for(const script of ['metrics.js','data.js','app.js'])vm.runInContext(fs.readFileSync(path.join(root,script),'utf8'),context,{filename:script});
    // Drain asynchronous initial refresh, without external services or a browser dependency.
    for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
    return {elements,state,context};
}
test('actual page scripts render shared metrics and safe event text across all loaded pages',async()=>{
    const {elements:e,state}=await setup();
    assert.equal(state.calls,3);assert.equal(e.cyclesGlobal.textContent,'2');
    assert.equal(e.runningTimeToday.textContent,'10m 0s');assert.equal(e.runningTimeYesterday.textContent,'10m 0s');
    assert.equal(e.avgRunningToday.textContent,'20m 0s');
    assert.equal(e.eventsBody.children.length,5);
    const latest=e.eventsBody.children[0];
    assert.equal(latest.children[2].textContent,'Stop without a start');
    assert.equal(latest.children[3].textContent,rows.at(-1).source_ip);
    assert.match(e.quality.textContent,/stops without a start/);
    assert.match(e.coverage.textContent,/Europe\/Lisbon/);
});
test('changing table limit never changes Global or requests history',async()=>{
    const {elements:e,state}=await setup();const calls=state.calls;
    e.limitInput.value='1';e.limitInput.handlers.change();
    assert.equal(e.eventsBody.children.length,1);assert.equal(e.cyclesGlobal.textContent,'2');assert.equal(state.calls,calls);
    e.limitInput.value='999';e.limitInput.handlers.change();assert.equal(e.limitInput.value,'500');
    e.limitInput.value='-1';e.limitInput.handlers.change();assert.equal(e.limitInput.value,'1');
});
test('failed refresh clears stale statistics and allows a successful retry',async()=>{
    const {elements:e,state,context}=await setup();state.fail=true;
    await vm.runInContext('refresh()',context);
    assert.equal(e.cyclesGlobal.textContent,'-');assert.equal(e.eventsTable.hidden,true);assert.equal(e.error.hidden,false);
    assert.match(e.error.textContent,/Statistics unavailable/);assert.equal(e.refreshBtn.disabled,false);
    state.fail=false;await vm.runInContext('refresh()',context);
    assert.equal(e.error.hidden,true);assert.equal(e.cyclesToday.textContent,'1');
});
test('empty history presents unknown coverage instead of zero activity',async()=>{
    const {elements:e,state,context}=await setup();state.rows=[];await vm.runInContext('refresh()',context);
    assert.equal(e.cyclesGlobal.textContent,'N/A');assert.equal(e.cyclesYesterday.textContent,'N/A');
    assert.equal(e.eventsTable.hidden,true);assert.equal(e.emptyMsg.hidden,false);
});

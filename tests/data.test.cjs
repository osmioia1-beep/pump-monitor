const { test }=require('node:test');
const assert=require('node:assert/strict');
const { fetchAllEvents }=require('../data.js');
const options={ baseUrl:'https://example.test', apiKey:'sb_publishable_test', cutoff:'2026-10-24T12:00:00Z' };
const response=(rows,range,ok=true)=>({ok,status:500,statusText:'Test failure',json:async()=>rows,headers:{get:()=>range}});
test('loads every page even when server cap is smaller than requested',async()=>{
    const urls=[];
    const all=await fetchAllEvents({...options,fetchImpl:async(url,init)=>{
        const u=new URL(url); urls.push(u);
        assert.equal(init.method,'GET'); assert.equal(init.headers.apikey,options.apiKey);
        assert.equal(init.headers.Authorization,undefined);
        assert.equal(u.searchParams.get('or'),`(ts.lte.${options.cutoff},ts.is.null)`);
        const offset=Number(u.searchParams.get('offset'));
        return offset===0?response([{event:'start'},{event:'stop'}],'0-1/3'):response([{event:'start'}],'2-2/3');
    }});
    assert.equal(all.length,3); assert.equal(urls.length,2); assert.equal(urls[1].searchParams.get('offset'),'2');
});
test('empty retained history succeeds',async()=>{
    assert.deepEqual(await fetchAllEvents({...options,fetchImpl:async()=>response([],'*/0')}),[]);
});
test('missing exact count is an error, not a partial Global',async()=>{
    await assert.rejects(fetchAllEvents({...options,fetchImpl:async()=>response([],'*/*')}),/coverage/);
});
test('empty page before total is reached fails',async()=>{
    let call=0;
    await assert.rejects(fetchAllEvents({...options,fetchImpl:async()=>++call===1?response([{}],'0-0/2'):response([],'*/2')}),/Incomplete/);
});
test('changed count rejects concurrent history mutation',async()=>{
    let call=0;
    await assert.rejects(fetchAllEvents({...options,fetchImpl:async()=>++call===1?response([{}],'0-0/2'):response([{}],'1-1/3')}),/changed/);
});
test('repeated or misaligned page is rejected',async()=>{
    await assert.rejects(fetchAllEvents({...options,fetchImpl:async()=>response([{}],'1-1/2')}),/Unexpected/);
});
test('later page failure rejects the whole load',async()=>{
    let call=0;
    await assert.rejects(fetchAllEvents({...options,fetchImpl:async()=>++call===1?response([{}],'0-0/2'):response([],null,false)}),/HTTP 500/);
});
test('oversized history fails explicitly without presenting truncated metrics',async()=>{
    await assert.rejects(fetchAllEvents({...options,fetchImpl:async()=>response([{}],'0-0/250001')}),/too large/);
});

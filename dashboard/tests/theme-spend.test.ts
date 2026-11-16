import assert from 'node:assert/strict';
import {test} from 'node:test';
import {costPerMinute,dailyChannelSpending,type CallCostInput} from '../lib/cost';
import {readTheme,subscribeTheme,setTheme} from '../lib/theme';

test('cost per minute uses actual seconds, never rounds up to a billed minute',()=>{
  assert.equal(costPerMinute(2,30),4);
  assert.equal(costPerMinute(12,150),4.8);
  assert.equal(costPerMinute(0,60),0);
  for(const seconds of [0,null,undefined,-1,Infinity]) assert.equal(costPerMinute(12,seconds),null);
});

test('daily graph preserves India midnight bins and channel totals',()=>{
  const base:CallCostInput={direction:'INBOUND',durationSeconds:60,llmInputTokens:1000000,llmOutputTokens:0,llmProviderUsed:'synthetic',llmSkuUsed:'model',sttSeconds:0,sttProviderUsed:null,sttSkuUsed:null,ttsChars:0,ttsProviderUsed:null,ttsSkuUsed:null,telephonyProvider:null};
  const calls=[{...base,createdAt:new Date('2026-11-11T18:29:00Z')},{...base,fromNumber:'demo-user',createdAt:new Date('2026-11-11T18:31:00Z')}];
  const bins=dailyChannelSpending(calls,new Map([['synthetic|model|LLM_INPUT_MTOK',2]]),2,new Date('2026-11-12T05:00:00Z'));
  assert.equal(bins[0].date,'2026-11-11');assert.equal(bins[0].Inbound,2);
  assert.equal(bins[1].date,'2026-11-12');assert.equal(bins[1].Demo,2);
  assert.equal(bins.reduce((sum,row)=>sum+row.Demo+row.Inbound+row.Outbound,0),4);
});

test('theme mount and remount never erase a saved choice; toggles share state',()=>{
  const previous={window:globalThis.window,document:globalThis.document,localStorage:globalThis.localStorage};
  const events=new EventTarget();let stored:string|null='light';let writes=0;
  Object.assign(globalThis,{window:{addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events),matchMedia:()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}})},document:{documentElement:{dataset:{}}},localStorage:{getItem:()=>stored,setItem:(_key:string,value:string)=>{writes++;stored=value;}}});
  try{
    for(let page=0;page<4;page++) {const stop=subscribeTheme(()=>{});assert.equal(readTheme(),'light');stop();}
    assert.equal(writes,0);setTheme('dark');assert.equal(readTheme(),'dark');
    const stop=subscribeTheme(()=>{});assert.equal(document.documentElement.dataset.theme,'dark');assert.equal(writes,1);stop();
  }finally{Object.assign(globalThis,previous);}
});

test('a rolling range retains the partial first India day instead of losing priced calls',()=>{
  const call:CallCostInput & {createdAt:Date}={direction:'OUTBOUND',createdAt:new Date('2026-11-05T17:30:00Z'),durationSeconds:30,llmInputTokens:1000000,llmOutputTokens:0,llmProviderUsed:'synthetic',llmSkuUsed:'model',sttSeconds:0,sttProviderUsed:null,sttSkuUsed:null,ttsChars:0,ttsProviderUsed:null,ttsSkuUsed:null,telephonyProvider:null};
  const rows=dailyChannelSpending([call],new Map([['synthetic|model|LLM_INPUT_MTOK',2]]),7,new Date('2026-11-12T08:00:00Z'));
  assert.equal(rows[0].date,'2026-11-05');
  assert.equal(rows.reduce((sum,row)=>sum+row.Outbound,0),2);
});

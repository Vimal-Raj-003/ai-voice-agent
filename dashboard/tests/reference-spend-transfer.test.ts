import assert from "node:assert/strict";
import test from "node:test";
import {Prisma} from "@prisma/client";
import {computeCallCost,buildRateMap,channelSpending,callChannel} from "../lib/cost";
import {extraTransferPeople,withTransferPeople} from "../lib/human-transfer";

const call = {direction:"INBOUND" as const,durationSeconds:60,llmProviderUsed:"google",llmSkuUsed:"gemini-3.8-live",
  llmInputTokens:1000,llmOutputTokens:2000,sttSeconds:60,sttProviderUsed:"google",sttSkuUsed:"gemini-3.8-live",
  ttsChars:300,ttsProviderUsed:"google",ttsSkuUsed:"gemini-3.8-live",telephonyProvider:null};
const rates = buildRateMap(([
  {provider:"google",sku:"gemini-3.8-live/text",kind:"LLM_INPUT_MTOK",rateUsd:.75},
  {provider:"google",sku:"gemini-3.8-live/text",kind:"LLM_OUTPUT_MTOK",rateUsd:4.5},
  {provider:"google",sku:"gemini-3.8-live/audio",kind:"LLM_INPUT_MTOK",rateUsd:3},
  {provider:"google",sku:"gemini-3.8-live/audio",kind:"LLM_OUTPUT_MTOK",rateUsd:12},
] as const).map(row=>({...row,rateUsd:new Prisma.Decimal(row.rateUsd)})));
test('native rate receipt keeps completed call prices stable when current rates change',()=>{
  const metadata={voiceUsage:{mode:'demo',engine:'gemini-live',provider:'google',model:'gemini-3.8-live',complete:true,tokens:{inputAudio:1000000,inputText:0,outputAudio:0,outputText:0},rateSnapshot:{version:1,capturedAt:'2026-11-11T00:00:00Z',rows:[{provider:'google',sku:'gemini-3.8-live/audio',kind:'LLM_INPUT_MTOK' as const,rateUsd:2}]}}};
  const result=computeCallCost({...call,metadata},rates);
  assert.equal(result.totalUsd,2);assert.equal(result.rateBasis,'call_snapshot');
  assert.equal(rates.get('google|gemini-3.8-live/audio|LLM_INPUT_MTOK'),3);
});
test('native demo receipt still prices actual modalities when ledger columns were initially empty',()=>{
  const metadata={voiceUsage:{mode:'demo',engine:'gemini-live',provider:'google',model:'gemini-3.8-live',complete:true,tokens:{inputAudio:1000,inputText:2000,outputAudio:3000,outputText:4000}}};
  const cost=computeCallCost({...call,llmProviderUsed:null,llmSkuUsed:null,sttSeconds:null,ttsChars:null,metadata},rates);
  assert(Math.abs(cost.totalUsd-.0585)<1e-9);
  assert.equal(cost.hasUnknownRates,false);
});
test("native audio and text cost use separate meters without double charging STT/TTS",()=>{
  const metadata={voiceUsage:{mode:"demo",complete:true,tokens:{inputAudio:1000,inputText:2000,outputAudio:3000,outputText:4000}}};
  const cost=computeCallCost({...call,metadata},rates);
  assert.equal(cost.lines.length,4);
  assert(Math.abs(cost.totalUsd-.0585)<1e-9);
  assert.equal(cost.hasUnknownRates,false);
  assert.equal(computeCallCost(call,rates).hasUnknownRates,true,"historical total tokens cannot masquerade as priced text");
  assert.equal(callChannel({...call,metadata}),"Demo");
  const [demo,inbound]=channelSpending([{...call,metadata},{...call,metadata:{}}],rates);
  assert.equal(demo.calls,1);assert.equal(inbound.calls,1);
  assert.equal(inbound.pricedUsd,0);assert.equal(inbound.incomplete,1);
});

test("browser demos never inherit carrier charges from legacy defaults",()=>{
  const withCarrier=new Map(rates);withCarrier.set('vobiz|inbound|TELEPHONY_MINUTE',1);
  const tracked={...call,durationSeconds:60,telephonyProvider:'vobiz'};
  const demo=computeCallCost({...tracked,metadata:{voiceUsage:{mode:'demo',complete:true,tokens:{}}}},withCarrier);
  assert(!demo.lines.some(line=>line.category==='TELEPHONY'));
  assert(computeCallCost(tracked,withCarrier).lines.some(line=>line.category==='TELEPHONY'));
});
test("more than four forwarding people round-trip while preserving unrelated metadata",()=>{
  const form=new FormData();
  const ids=Array.from({length:7},(_,i)=>`person_00000000-0000-0000-0000-${String(i).padStart(12,'0')}`);
  form.set("transferExtraIds",JSON.stringify(ids));
  for(const id of ids){form.set(`transfer_${id}_intent`,"software");form.set(`transfer_${id}_label`,"Synthetic support");
    form.set(`transfer_${id}_phone`,"+919000000000");form.set(`transfer_${id}_enabled`,"on");form.set(`transfer_${id}_priority`,"9");}
  const metadata=withTransferPeople({voiceRuntime:{engine:"gemini-live"},speechReferences:[{id:"keep"}]},form);
  assert.equal(extraTransferPeople(metadata).length,7);
  assert.deepEqual(metadata.voiceRuntime,{engine:"gemini-live"});
  form.set("transferExtraIds","[]");
  assert.equal(extraTransferPeople(withTransferPeople(metadata,form)).length,0);
  form.set("transferExtraIds",JSON.stringify(ids));form.set(`transfer_${ids[0]}_phone`,"bad");
  assert.throws(()=>withTransferPeople(metadata,form),/valid phone/);
});

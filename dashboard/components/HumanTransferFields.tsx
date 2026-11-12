"use client";

import {useState} from "react";
import {ChevronRight,Plus,X} from "lucide-react";
import {TRANSFER_CATEGORIES, E164_RE, type ExtraTransferPerson} from "@/lib/human-transfer";
import InfoTooltip from "./InfoTooltip";
import Select from "./Select";
import SettingsDialog from "./SettingsDialog";

export type TransferTarget = {category: string; label: string; phoneE164: string | null; enabled: boolean; priority: number};
type Person = TransferTarget & {id: string; present: boolean; extra: boolean};

export default function HumanTransferFields({targets, extraPeople = []}: {
  targets: TransferTarget[]; extraPeople?: ExtraTransferPerson[];
}) {
  const [open,setOpen]=useState(false);
  const [people, setPeople] = useState<Person[]>(() => [
    ...TRANSFER_CATEGORIES.map(c => {
      const stored = targets.find(t => t.category === c.category);
      return {...c, phoneE164:null, enabled:false, priority:100, ...stored, id:c.category, present:!!stored, extra:false};
    }),
    ...extraPeople.map(p => ({...p, present:true, extra:true})),
  ]);
  const update = (id: string, patch: Partial<Person>) => setPeople(rows => rows.map(p => p.id === id ? {...p,...patch} : p));
  const add = () => {
    setOpen(true);
    const free = people.find(p => !p.present && !p.extra);
    if (free) update(free.id, {present:true});
    else setPeople(rows => [...rows, {id:`person_${crypto.randomUUID()}`, category:"other", label:"", phoneE164:null,
      enabled:false, priority:100, present:true, extra:true}]);
  };
  const visible = people.filter(p => p.present);
  const input = "w-full min-w-0 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40";
  return <section className="glass flex flex-col gap-2 rounded-2xl p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="flex items-center gap-1 font-semibold"><button type="button" aria-haspopup="dialog" onClick={()=>setOpen(true)} className="flex items-center gap-1 text-left focus-visible:outline-2"><ChevronRight size={15} className="shrink-0"/>Human call forwarding</button>
        <InfoTooltip>Configure trusted destinations for live calls. The assistant selects a person or team by name and intent; phone numbers stay private. Team requests use the lowest configured priority. Demo transfers stay simulated.</InfoTooltip>
      </h3>
    </div>
    {!!visible.length&&<p className="truncate text-xs text-gray-400">{visible.slice(0,3).map(p=>p.label||'Unnamed person').join(' · ')}{visible.length>3?` · +${visible.length-3} more`:''}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs font-normal text-gray-400">{visible.length} people · {visible.filter(p=>p.enabled&&p.phoneE164).length} enabled</span>
      <button type="button" onClick={add} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-sm text-violet-200">
        <Plus size={16}/> Add person
      </button>
    </div>
    <SettingsDialog open={open} onOpen={()=>setOpen(true)} onClose={()=>setOpen(false)} title="Human call forwarding" note="Save the assistant to apply forwarding changes.">
    <input type="hidden" name="transferExtraIds" value={JSON.stringify(people.filter(p => p.extra && p.present).map(p => p.id))}/>
    <div className="grid items-start gap-3 lg:grid-cols-2">
      {people.map(p => !p.present ? (!p.extra && <input key={p.id} type="hidden" name={`transfer_${p.id}_priority`} value={p.priority}/>) :
        <div key={p.id} className="grid items-end gap-3 rounded-lg border border-white/10 p-3 sm:grid-cols-2">
            <label className="block space-y-1"><span className="text-sm text-gray-400">Name / team</span>
              <input name={`transfer_${p.id}_label`} value={p.label} onChange={e=>update(p.id,{label:e.target.value})} placeholder="e.g. Support team" className={input}/></label>
            {p.extra ? <label className="block space-y-1"><span className="text-sm text-gray-400">Handles</span>
              <Select name={`transfer_${p.id}_intent`} defaultValue={p.category} onChange={category=>update(p.id,{category})}
                options={TRANSFER_CATEGORIES.map(c=>({value:c.category,label:c.label}))}/></label> :
              <div className="text-sm text-gray-400 self-center">Handles {TRANSFER_CATEGORIES.find(c=>c.category===p.category)?.label}</div>}
            <label className="block space-y-1"><span className="text-sm text-gray-400">Phone with country code</span>
              <input name={`transfer_${p.id}_phone`} value={p.phoneE164 || ""} onChange={e=>update(p.id,{phoneE164:e.target.value})}
                placeholder="+919876543210" inputMode="tel" aria-invalid={!!p.phoneE164 && !E164_RE.test(p.phoneE164)} className={input}/></label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name={`transfer_${p.id}_enabled`} checked={p.enabled}
            onChange={e=>update(p.id,{enabled:e.target.checked})} className="accent-violet-400"/> Enable forwarding</label>
          <button type="button" aria-label={`Remove ${p.label || "person"}`} onClick={() => update(p.id,{present:false, phoneE164:null,enabled:false})}
            className="flex min-h-9 items-center justify-center gap-1 rounded-lg p-1.5 text-xs text-gray-400 hover:bg-red-500/10 hover:text-red-300 sm:col-span-2"><X size={14}/>Remove</button>
          <input type="hidden" name={`transfer_${p.id}_priority`} value={p.priority}/>
          {p.phoneE164 && !E164_RE.test(p.phoneE164) && <p className="text-sm text-red-300">Use a plus, country code and phone number.</p>}
        </div>)}
    </div>
    {!visible.length && <p className="text-sm text-gray-400">No people configured. Add a person to enable human handoff.</p>}
    </SettingsDialog>
  </section>;
}

"use client";

import {useEffect,useId,useRef} from "react";
import {X} from "lucide-react";

const stack:string[]=[];
let previousOverflow="";

export default function SettingsDialog({open,onClose,onOpen,title,children,note}:{
  open:boolean;onClose:()=>void;onOpen?:()=>void;title:string;children:React.ReactNode;note?:string;
}) {
  const id=useId();
  const panel=useRef<HTMLDivElement>(null);
  const close=useRef(onClose);
  useEffect(()=>{close.current=onClose;},[onClose]);
  useEffect(()=>{
    if(!open)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    if(!stack.length){previousOverflow=document.body.style.overflow;document.body.style.overflow="hidden";}
    stack.push(id);
    const focusable=()=>Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not([type=hidden]):not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')??[]).filter(e=>e.getClientRects().length);
    const frame=requestAnimationFrame(()=>{
      const first=panel.current?.querySelector<HTMLElement>('input:not([type=hidden]):not(:disabled),textarea:not(:disabled),[role=option][aria-selected=true]');
      (first??focusable()[0]??panel.current)?.focus();
    });
    const keydown=(event:KeyboardEvent)=>{
      if(stack.at(-1)!==id||event.defaultPrevented)return;
      if(event.key==='Escape'){event.preventDefault();close.current();}
      if(event.key==='Tab'){
        const items=focusable();const first=items[0];const last=items.at(-1);
        if(!first){event.preventDefault();panel.current?.focus();return;}
        if(event.shiftKey&&(document.activeElement===first||!panel.current?.contains(document.activeElement))){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&(document.activeElement===last||!panel.current?.contains(document.activeElement))){event.preventDefault();first.focus();}
      }
    };
    document.addEventListener('keydown',keydown);
    return()=>{
      cancelAnimationFrame(frame);document.removeEventListener('keydown',keydown);
      const index=stack.lastIndexOf(id);if(index>=0)stack.splice(index,1);
      if(!stack.length)document.body.style.overflow=previousOverflow;
      if(previous?.isConnected&&previous.getClientRects().length)previous.focus();
    };
  },[open,id]);
  return <div hidden={!open} data-settings-dialog={title} role={open?'dialog':undefined} aria-modal={open?true:undefined} aria-labelledby={open?id:undefined}
    className="modal-backdrop fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6"
    onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}
    onInvalidCapture={e=>{if(!open&&onOpen){e.preventDefault();onOpen();const input=e.target as HTMLInputElement;requestAnimationFrame(()=>{input.focus();input.reportValidity();});}}}>
    <div ref={panel} tabIndex={-1} className="modal-surface flex max-h-[85svh] w-full max-w-4xl flex-col rounded-2xl p-4 sm:p-6">
      <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
        <h2 id={id} className="text-base font-semibold">{title}</h2>
        <button type="button" aria-label={`Close ${title}`} onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-white/10 focus-visible:outline-2"><X size={18}/></button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain">{children}</div>
      <div className="mt-4 flex shrink-0 items-center justify-between gap-3 border-t border-white/10 pt-3">
        <span className="text-xs text-gray-400">{note}</span>
        <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-white/10 px-4 py-2 text-sm hover:bg-white/5 focus-visible:outline-2">Done</button>
      </div>
    </div>
  </div>;
}

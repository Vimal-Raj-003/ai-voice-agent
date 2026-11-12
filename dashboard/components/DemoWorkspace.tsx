"use client";
import {useState} from "react";
import DemoWidget,{type DemoAssistantOption} from "./DemoWidget";
import DemoHistory from "./DemoHistory";

export default function DemoWorkspace({assistants,initialAssistantId}:{assistants:DemoAssistantOption[];initialAssistantId:string}){
  const [refreshKey,setRefreshKey]=useState(0);
  return <div className="flex min-h-0 flex-col gap-4 lg:h-[calc(100svh-150px)]"><DemoWidget assistants={assistants} initialAssistantId={initialAssistantId} onFinished={()=>setRefreshKey(key=>key+1)}/><DemoHistory refreshKey={refreshKey}/></div>;
}

"use client";
import {Bar,BarChart,CartesianGrid,Legend,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {useCurrency} from '@/lib/currency-context';
import {formatMoney} from '@/lib/currency';
import type {DailyChannelSpend} from '@/lib/cost';

export default function CallTypeSpend({data}:{data:DailyChannelSpend[]}) {
  const {currency,fx}=useCurrency();
  const money=(value:number)=>formatMoney(value,currency,fx.rate,2);
  return <div className="h-64 min-w-0" role="img" aria-label="Daily estimated spend by Demo, Inbound and Outbound calls, grouped by India calendar date">
    <ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{top:12,right:12,left:0,bottom:0}}>
      <CartesianGrid vertical={false} stroke="var(--border-default)"/>
      <XAxis dataKey="date" tickFormatter={date=>date.slice(5)} tickLine={false} axisLine={false} stroke="var(--text-muted)" fontSize={11}/>
      <YAxis tickFormatter={money} tickLine={false} axisLine={false} stroke="var(--text-muted)" fontSize={11} width={64}/>
      <Tooltip contentStyle={{background:'var(--bg-elevated)',border:'1px solid var(--border-default)',borderRadius:10}} formatter={(value,name)=>[money(Number(value)),String(name)]} labelFormatter={label=>`${label} · IST`}/>
      <Legend iconType="circle" wrapperStyle={{fontSize:12}}/>
      <Bar name="Demo" dataKey="Demo" stackId="spend" fill="var(--chart-demo)" isAnimationActive={false}/>
      <Bar name="Inbound" dataKey="Inbound" stackId="spend" fill="var(--chart-inbound)" isAnimationActive={false}/>
      <Bar name="Outbound" dataKey="Outbound" stackId="spend" fill="var(--chart-outbound)" isAnimationActive={false} radius={[3,3,0,0]}/>
    </BarChart></ResponsiveContainer>
  </div>;
}

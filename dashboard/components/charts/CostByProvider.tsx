"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { providerColor } from "@/lib/provider-colors";
import { type Currency, formatMoney } from "@/lib/currency";

export default function CostByProvider({
  data,
  currency = "USD",
  fxRate = null,
}: {
  data: Array<{ provider: string; costUsd: number }>;
  currency?: Currency;
  fxRate?: number | null;
}) {
  const total = data.reduce((s, d) => s + d.costUsd, 0);
  const money = (v: number, d: number) => formatMoney(v, currency, fxRate, d);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            innerRadius={60}
            outerRadius={90}
            paddingAngle={3}
            dataKey="costUsd"
            nameKey="provider"
            stroke="rgba(0,0,0,0.4)"
            strokeWidth={2}
          >
            {data.map((d) => (
              <Cell key={d.provider} fill={providerColor(d.provider)} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: "rgba(10, 12, 30, 0.92)",
              border: "1px solid rgba(167, 139, 250, 0.3)",
              borderRadius: 12,
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--text-primary)" }}
            formatter={(v) => money(Number(v), 4)}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-2xl font-bold text-gradient">
          {money(total, 2)}
        </div>
        <div className="text-[10px] uppercase tracking-widest text-gray-500">
          last 14 days
        </div>
      </div>
    </div>
  );
}

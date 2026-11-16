import {costPerMinute} from '@/lib/cost';
import Money from './Money';

export default function CallSpend({totalUsd,seconds}:{totalUsd:number;seconds:number|null|undefined}) {
  const perMinute=costPerMinute(totalUsd,seconds);
  return <div className="text-right tabular-nums">
    <div className="font-semibold text-primary">Call total <Money usd={totalUsd} decimals={4}/></div>
    <div className="mt-1 text-xs text-muted">{perMinute==null?'Per-minute cost unavailable':<>Avg <Money usd={perMinute} decimals={4}/> / min</>}</div>
  </div>;
}

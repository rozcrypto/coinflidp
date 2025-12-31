import { Flame, Gift, Zap, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FlipRecord {
  id: number;
  result: "burn" | "holder";
  timestamp: Date;
}

interface LiveFeedProps {
  history: FlipRecord[];
}

const LiveFeed = ({ history }: LiveFeedProps) => {
  const recent = history.slice(-25).reverse();

  return (
    <div className="rounded-2xl overflow-hidden bg-gradient-to-b from-card to-background border border-border">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/20">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold">Live Feed</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-live" />
          <span className="text-[9px] text-primary font-semibold uppercase">Live</span>
        </div>
      </div>

      {/* Quick results strip */}
      {history.length > 0 && (
        <div className="px-4 py-2.5 border-b border-border/50 bg-background/50">
          <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-none">
            {history.slice(-25).reverse().map((record, i) => (
              <div
                key={record.id}
                className={cn(
                  "w-5 h-5 rounded flex items-center justify-center shrink-0 transition-all",
                  record.result === "burn" ? "bg-ember/15" : "bg-royal/15",
                  i === 0 && "ring-1 ring-primary/50 scale-125 mx-1"
                )}
              >
                {record.result === "burn" ? (
                  <Flame className="w-2.5 h-2.5 text-ember" />
                ) : (
                  <Gift className="w-2.5 h-2.5 text-royal" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* List */}
      <div className="max-h-44 overflow-y-auto">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 px-4">
            <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3 animate-float">
              <Zap className="w-5 h-5 text-muted-foreground/50" />
            </div>
            <p className="text-[11px] text-muted-foreground">Waiting for flips...</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {recent.slice(0, 8).map((record, i) => (
              <div
                key={record.id}
                className={cn(
                  "flex items-center justify-between px-4 py-2.5 hover:bg-muted/10 transition-colors",
                  i === 0 && "bg-muted/10"
                )}
              >
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-6 h-6 rounded-md flex items-center justify-center",
                    record.result === "burn" ? "bg-ember/10" : "bg-royal/10"
                  )}>
                    {record.result === "burn" ? (
                      <Flame className="w-3 h-3 text-ember" />
                    ) : (
                      <Gift className="w-3 h-3 text-royal" />
                    )}
                  </div>
                  <span className={cn(
                    "text-[11px] font-semibold",
                    record.result === "burn" ? "text-ember" : "text-royal"
                  )}>
                    {record.result === "burn" ? "Burn" : "Holder"}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {record.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveFeed;

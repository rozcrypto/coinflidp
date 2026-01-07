import { cn } from "@/lib/utils";
import { Flame, Gift, History, ExternalLink } from "lucide-react";

// Dev wallet address for Solscan link on burn results
const DEV_WALLET_ADDRESS = "Hc9T2axADf6wCFBADfjEqRfNmznWafLQM61E2F3N36bh";

export interface FlipRecord {
  id: number;
  result: "burn" | "holder";
  timestamp: Date;
  txHash?: string | null;
}

interface CasinoHistoryProps {
  history: FlipRecord[];
}

const CasinoHistory = ({ history }: CasinoHistoryProps) => {
  const recentHistory = history.slice(-20).reverse();

  return (
    <div className="w-full max-w-2xl">
      <div className="casino-card rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <History className="w-5 h-5 text-muted-foreground" />
            <span className="font-semibold text-foreground">Recent Flips</span>
          </div>
          <span className="text-xs text-muted-foreground px-2 py-1 rounded-full bg-secondary">
            {history.length} total
          </span>
        </div>

        {/* Quick results row */}
        {history.length > 0 && (
          <div className="px-6 py-3 border-b border-border bg-secondary/30">
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              <span className="text-xs text-muted-foreground mr-2 shrink-0">Latest:</span>
              {history.slice(-15).reverse().map((record, index) => (
                <div
                  key={record.id}
                  className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all",
                    record.result === "burn"
                      ? "bg-ember/20 border border-ember/30"
                      : "bg-royal/20 border border-royal/30",
                    index === 0 && "ring-2 ring-primary/50 scale-110"
                  )}
                  title={`${record.result === "burn" ? "Burn" : "Holder"} - ${record.timestamp.toLocaleTimeString()}`}
                >
                  {record.result === "burn" ? (
                    <Flame className="w-3.5 h-3.5 text-ember" />
                  ) : (
                    <Gift className="w-3.5 h-3.5 text-royal" />
                  )}
                </div>
              ))}
              {history.length > 15 && (
                <span className="text-xs text-muted-foreground ml-2">+{history.length - 15}</span>
              )}
            </div>
          </div>
        )}

        {/* History list */}
        <div className="max-h-64 overflow-y-auto">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6">
              <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center mb-4">
                <History className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground text-sm">No flips yet</p>
              <p className="text-muted-foreground/60 text-xs mt-1">Waiting for first flip...</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentHistory.map((record, index) => (
                <div
                  key={record.id}
                  className={cn(
                    "flex items-center justify-between px-6 py-3 hover:bg-secondary/30 transition-colors",
                    index === 0 && "bg-secondary/20"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-9 h-9 rounded-xl flex items-center justify-center",
                      record.result === "burn"
                        ? "bg-ember/15 border border-ember/20"
                        : "bg-royal/15 border border-royal/20"
                    )}>
                      {record.result === "burn" ? (
                        <Flame className="w-4 h-4 text-ember" />
                      ) : (
                        <Gift className="w-4 h-4 text-royal" />
                      )}
                    </div>
                    <div>
                      <p className={cn(
                        "font-medium text-sm",
                        record.result === "burn" ? "text-ember" : "text-royal"
                      )}>
                        {record.result === "burn" ? "Buyback & Burn (TBD)" : "Random Holder (TBD)"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Flip #{history.length - history.indexOf(record)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-mono">
                      {record.timestamp.toLocaleTimeString()}
                    </span>
                    {record.result === "burn" ? (
                      <a
                        href={`https://solscan.io/account/${DEV_WALLET_ADDRESS}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-ember hover:text-ember/80 transition-colors"
                        title="View Dev Wallet on Solscan"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : record.txHash ? (
                      <a
                        href={`https://solscan.io/tx/${record.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-royal hover:text-royal/80 transition-colors"
                        title="View Transaction on Solscan"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CasinoHistory;

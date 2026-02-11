import { ExternalLink, Trophy, Flame, Clock, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WinnerRecord {
  id: string | number;
  type: "burn" | "holder";
  wallet?: string;
  amount: number;
  solAmount?: number;
  txHash?: string;
  timestamp: Date;
}

interface WinnersPanelProps {
  winners: WinnerRecord[];
}

// USDC Logo Component
const USDCLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 32 32" className={className} fill="none">
    <circle cx="16" cy="16" r="16" fill="#2775CA"/>
    <path d="M20.5 18.2c0-2.1-1.3-2.8-3.8-3.1-1.8-.3-2.2-.7-2.2-1.5s.7-1.3 1.8-1.3c1 0 1.6.4 1.9 1.2.1.2.2.3.4.3h.9c.3 0 .4-.2.4-.4-.3-1.2-1.1-2.1-2.4-2.4v-1.4c0-.2-.2-.4-.5-.4h-.8c-.2 0-.4.2-.5.4v1.3c-1.6.3-2.6 1.3-2.6 2.7 0 2 1.2 2.7 3.8 3.1 1.6.3 2.2.8 2.2 1.6s-.9 1.4-2 1.4c-1.5 0-2-.7-2.2-1.4-.1-.2-.2-.3-.4-.3h-1c-.2 0-.4.2-.4.4.3 1.4 1.2 2.3 2.8 2.6v1.4c0 .2.2.4.5.4h.8c.2 0 .4-.2.5-.4v-1.4c1.6-.3 2.7-1.4 2.7-2.9z" fill="white"/>
    <path d="M12.8 25.2c-4.2-1.5-6.4-6.2-4.8-10.4 1-2.5 3-4.2 5.5-4.8.2-.1.4-.2.4-.5v-.8c0-.2-.2-.4-.4-.4-.1 0-.1 0-.2.1-5 1.5-7.9 6.8-6.4 11.9 1 3.1 3.3 5.4 6.4 6.4.2.1.5-.1.5-.3v-.8c0-.3-.2-.4-.5-.5zm6.4-16.4c-.2-.1-.5.1-.5.3v.8c0 .2.2.5.5.5 4.2 1.5 6.4 6.2 4.8 10.4-1 2.5-3 4.2-5.5 4.8-.2.1-.4.2-.4.5v.8c0 .2.2.4.4.4.1 0 .1 0 .2-.1 5-1.5 7.9-6.8 6.4-11.9-1-3.1-3.3-5.4-6.4-6.4z" fill="white"/>
  </svg>
);

const WinnersPanel = ({ winners }: WinnersPanelProps) => {
  const formatWallet = (wallet: string) => {
    return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
  };

  const formatAmount = (amount: number) => {
    if (amount >= 1000000) return `${(amount / 1000000).toFixed(2)}M`;
    if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
    return amount.toLocaleString();
  };

  const recentWinners = winners.slice(-12).reverse();
  const burnCount = winners.filter(w => w.type === "burn").length;
  const holderCount = winners.filter(w => w.type === "holder").length;

  return (
    <div className="rounded-2xl overflow-hidden glass-premium">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center border border-accent/10">
            <Trophy className="w-4 h-4 text-accent" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Transaction History</h3>
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <USDCLogo className="w-2.5 h-2.5" />
              Verified on Solscan
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-ember/10 border border-ember/20">
            <Flame className="w-3 h-3 text-ember" />
            <span className="text-[10px] font-bold text-ember">{burnCount}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20">
            <Trophy className="w-3 h-3 text-primary" />
            <span className="text-[10px] font-bold text-primary">{holderCount}</span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/30">
              <th className="px-5 py-3 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Type
              </th>
              <th className="px-5 py-3 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Recipient
              </th>
              <th className="px-5 py-3 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Amount
              </th>
              <th className="px-5 py-3 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Time
              </th>
              <th className="px-5 py-3 text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                TX
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {winners.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-16 text-center">
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-muted/30 flex items-center justify-center border border-border/50 animate-float">
                      <Clock className="w-7 h-7 text-muted-foreground/40" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground font-medium">No transactions yet</p>
                      <p className="text-[11px] text-muted-foreground/50 mt-1">Waiting for first flip...</p>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              recentWinners.map((winner, index) => (
                <tr 
                  key={winner.id}
                  className={cn(
                    "group hover:bg-muted/5 transition-all duration-300",
                    index === 0 && "animate-row-highlight"
                  )}
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2.5">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 group-hover:scale-110",
                        winner.type === "burn" 
                          ? "bg-gradient-to-br from-ember/20 to-ember/5 border border-ember/20" 
                          : "bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20"
                      )}>
                        {winner.type === "burn" ? (
                          <Flame className="w-3.5 h-3.5 text-ember" />
                        ) : (
                          <Trophy className="w-3.5 h-3.5 text-primary" />
                        )}
                      </div>
                      <span className={cn(
                        "text-xs font-semibold",
                        winner.type === "burn" ? "text-ember" : "text-primary"
                      )}>
                        {winner.type === "burn" ? "Burn" : "Reward"}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="font-mono text-xs text-foreground/80">
                      {winner.type === "burn" ? (
                        <span className="text-ember flex items-center gap-1">
                          <Flame className="w-3 h-3" />
                          Burned
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-md bg-muted/30 border border-border/50">
                          {formatWallet(winner.wallet || "")}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex flex-col items-end">
                      <span className={cn(
                        "font-mono text-sm font-bold",
                        winner.type === "burn" ? "text-ember" : "text-primary"
                      )}>
                        {formatAmount(winner.amount)}
                      </span>
                      <span className="text-[9px] text-muted-foreground">USDC</span>
                    </div>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <span className="text-[11px] text-muted-foreground font-medium">
                      {winner.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <a
                      href={`https://solscan.io/tx/${winner.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        "inline-flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-300",
                        "bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 hover:border-primary/30",
                        "hover:scale-110 hover:shadow-[0_0_20px_hsl(209_66%_47%_/_0.2)]"
                      )}
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      {winners.length > 12 && (
        <div className="px-5 py-3 border-t border-border/30 bg-muted/5">
          <button className="w-full text-center text-xs text-primary hover:text-primary/80 font-semibold transition-colors flex items-center justify-center gap-1">
            View all {winners.length} transactions
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
};

export default WinnersPanel;

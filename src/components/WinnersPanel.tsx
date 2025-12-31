import { ExternalLink, Trophy, Flame, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WinnerRecord {
  id: number;
  type: "burn" | "holder";
  wallet?: string;
  amount: number;
  solAmount?: number;
  txHash: string;
  timestamp: Date;
}

interface WinnersPanelProps {
  winners: WinnerRecord[];
}

// Solana Logo
const SolanaLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 397.7 311.7" className={className} fill="currentColor">
    <linearGradient id="sol-grad-2" x1="360.879" y1="351.455" x2="141.213" y2="-69.294" gradientTransform="matrix(1 0 0 -1 0 314)" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#00FFA3"/>
      <stop offset="1" stopColor="#DC1FFF"/>
    </linearGradient>
    <path fill="url(#sol-grad-2)" d="M64.6,237.9c2.4-2.4,5.7-3.8,9.2-3.8h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,237.9z"/>
    <path fill="url(#sol-grad-2)" d="M64.6,3.8C67.1,1.4,70.4,0,73.8,0h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,3.8z"/>
    <path fill="url(#sol-grad-2)" d="M333.1,120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8,0-8.7,7-4.6,11.1l62.7,62.7c2.4,2.4,5.7,3.8,9.2,3.8h317.4c5.8,0,8.7-7,4.6-11.1L333.1,120.1z"/>
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

  const recentWinners = winners.slice(-10).reverse();

  return (
    <div className="rounded-2xl overflow-hidden bg-gradient-to-b from-card to-background border border-border">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-muted/20">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
            <Trophy className="w-4 h-4 text-accent" />
          </div>
          <div>
            <span className="font-semibold text-sm">Winners & Burns</span>
            <p className="text-[10px] text-muted-foreground">Verified on Solscan</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SolanaLogo className="w-4 h-4" />
          <span className="text-[10px] text-muted-foreground font-medium px-2 py-1 rounded-full bg-muted">
            {winners.length} txns
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/50">
              <th className="px-5 py-3 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Type
              </th>
              <th className="px-5 py-3 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Address
              </th>
              <th className="px-5 py-3 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Amount
              </th>
              <th className="px-5 py-3 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Time
              </th>
              <th className="px-5 py-3 text-center text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Verify
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {winners.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center">
                      <Clock className="w-7 h-7 text-muted-foreground/40" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground font-medium">No transactions yet</p>
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5">Waiting for first flip...</p>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              recentWinners.map((winner, index) => (
                <tr 
                  key={winner.id}
                  className={cn(
                    "group hover:bg-muted/10 transition-colors",
                    index === 0 && "animate-row-highlight"
                  )}
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110",
                        winner.type === "burn" ? "bg-ember/15" : "bg-royal/15"
                      )}>
                        {winner.type === "burn" ? (
                          <Flame className="w-4 h-4 text-ember" />
                        ) : (
                          <Trophy className="w-4 h-4 text-royal" />
                        )}
                      </div>
                      <span className={cn(
                        "text-xs font-semibold",
                        winner.type === "burn" ? "text-ember" : "text-royal"
                      )}>
                        {winner.type === "burn" ? "Burn" : "Reward"}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="font-mono text-xs text-foreground">
                      {winner.type === "burn" ? (
                        <span className="text-ember">🔥 Burned</span>
                      ) : (
                        formatWallet(winner.wallet || "")
                      )}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <span className={cn(
                      "font-mono text-xs font-semibold",
                      winner.type === "burn" ? "text-ember" : "text-royal"
                    )}>
                      {formatAmount(winner.amount)}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-1">tokens</span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <span className="text-[11px] text-muted-foreground font-medium">
                      {winner.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <a
                      href={`https://solscan.io/tx/${winner.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-all hover:scale-110"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      {winners.length > 10 && (
        <div className="px-5 py-3 border-t border-border/50 text-center bg-muted/10">
          <button className="text-xs text-primary hover:text-primary/80 font-semibold transition-colors">
            View all {winners.length} transactions →
          </button>
        </div>
      )}
    </div>
  );
};

export default WinnersPanel;

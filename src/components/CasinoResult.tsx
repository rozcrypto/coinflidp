import { cn } from "@/lib/utils";
import { Flame, Trophy, Sparkles, ExternalLink } from "lucide-react";

interface CasinoResultProps {
  result: "burn" | "holder" | null;
  isVisible: boolean;
  txHash?: string;
  wallet?: string;
  amount?: number;
}

const CasinoResult = ({ result, isVisible, txHash, wallet, amount }: CasinoResultProps) => {
  if (!isVisible || !result) return null;

  const isBurn = result === "burn";
  const solscanUrl = txHash ? `https://solscan.io/tx/${txHash}` : "#";

  const formatWallet = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/85 backdrop-blur-sm animate-in fade-in duration-200" />

      {/* Result card */}
      <div className={cn(
        "relative animate-slide-up pointer-events-auto",
        "stake-card-elevated rounded-2xl px-10 py-8 border max-w-sm mx-4",
        isBurn 
          ? "border-ember/30 glow-ember" 
          : "border-primary/30 glow-green"
      )}>
        {/* Top accent */}
        <div className={cn(
          "absolute top-0 left-1/2 -translate-x-1/2 w-24 h-0.5 rounded-b-full",
          isBurn 
            ? "bg-gradient-to-r from-transparent via-ember to-transparent"
            : "bg-gradient-to-r from-transparent via-primary to-transparent"
        )} />

        <div className="flex flex-col items-center gap-5 text-center">
          {/* Icon */}
          <div className={cn(
            "relative w-16 h-16 rounded-xl flex items-center justify-center",
            isBurn 
              ? "bg-ember/15 border border-ember/25"
              : "bg-primary/15 border border-primary/25"
          )}>
            <Sparkles className={cn(
              "absolute w-4 h-4 -top-1.5 -right-1.5 animate-pulse",
              isBurn ? "text-ember/50" : "text-primary/50"
            )} />
            
            {isBurn ? (
              <Flame className="w-8 h-8 text-ember" />
            ) : (
              <Trophy className="w-8 h-8 text-primary" />
            )}
          </div>

          {/* Text */}
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest mb-1.5">
              Result
            </p>
            <h2 className={cn(
              "text-2xl font-bold tracking-wide",
              isBurn ? "text-gradient-ember" : "text-gradient-usdc"
            )}>
              {isBurn ? "BUYBACK & BURN" : "HOLDER REWARD"}
            </h2>
          </div>

          {/* Amount & Wallet Info */}
          {amount && (
            <div className="text-center">
              <p className="text-lg font-bold text-foreground">
                {amount.toFixed(4)} <span className="text-muted-foreground text-sm font-normal">USDC</span>
              </p>
              {!isBurn && wallet && (
                <p className="text-sm text-muted-foreground mt-1">
                  Sent to <span className="font-mono text-foreground">{formatWallet(wallet)}</span>
                </p>
              )}
            </div>
          )}

          {/* Description */}
          <p className="text-muted-foreground text-sm leading-relaxed max-w-[260px]">
            {isBurn
              ? "Tokens will be purchased and burned permanently."
              : "A random holder has been selected for the USDC reward!"}
          </p>

          {/* View on Solscan button */}
          {txHash && (
            <a
              href={solscanUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300",
                isBurn 
                  ? "bg-ember/15 text-ember border border-ember/25 hover:bg-ember/25 hover:border-ember/40"
                  : "bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 hover:border-primary/40"
              )}
            >
              <span>View on Solscan</span>
              <ExternalLink className="w-4 h-4" />
            </a>
          )}

          {/* Processing Badge */}
          <div className={cn(
            "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium",
            isBurn 
              ? "bg-ember/10 text-ember border border-ember/15"
              : "bg-primary/10 text-primary border border-primary/15"
          )}>
            <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
            Processing...
          </div>
        </div>
      </div>
    </div>
  );
};

export default CasinoResult;

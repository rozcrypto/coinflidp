import { useState, useCallback } from "react";
import { Play, Pause, RotateCcw, Zap, Flame, Gift, Info, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import CasinoBackground from "@/components/CasinoBackground";
import CasinoCoin from "@/components/CasinoCoin";
import CasinoTimer from "@/components/CasinoTimer";
import CasinoResult from "@/components/CasinoResult";
import RewardsPanel from "@/components/RewardsPanel";
import WinnersPanel, { WinnerRecord } from "@/components/WinnersPanel";
import LiveFeed, { FlipRecord } from "@/components/LiveFeed";

const FLIP_INTERVAL = 120;

// Solana Logo Component
const SolanaLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 397.7 311.7" className={className} fill="currentColor">
    <linearGradient id="sol-main" x1="360.879" y1="351.455" x2="141.213" y2="-69.294" gradientTransform="matrix(1 0 0 -1 0 314)" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#00FFA3"/>
      <stop offset="1" stopColor="#DC1FFF"/>
    </linearGradient>
    <path fill="url(#sol-main)" d="M64.6,237.9c2.4-2.4,5.7-3.8,9.2-3.8h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,237.9z"/>
    <path fill="url(#sol-main)" d="M64.6,3.8C67.1,1.4,70.4,0,73.8,0h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,3.8z"/>
    <path fill="url(#sol-main)" d="M333.1,120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8,0-8.7,7-4.6,11.1l62.7,62.7c2.4,2.4,5.7,3.8,9.2,3.8h317.4c5.8,0,8.7-7,4.6-11.1L333.1,120.1z"/>
  </svg>
);

const MOCK_WALLETS = [
  "7xKXp3mN9", "BvR2pQ8kL", "9aZxW4yLm", "mN3pK7vRs",
  "Qw8mXt2Pn", "Lp5zHj9Nc", "Yk4rBs6Mq", "Df2wNg8Xv"
];

const generateMockTxHash = () => {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let hash = "";
  for (let i = 0; i < 64; i++) {
    hash += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return hash;
};

const Index = () => {
  const [isRunning, setIsRunning] = useState(true);
  const [isFlipping, setIsFlipping] = useState(false);
  const [currentResult, setCurrentResult] = useState<"burn" | "holder" | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [history, setHistory] = useState<FlipRecord[]>([]);
  const [winners, setWinners] = useState<WinnerRecord[]>([]);
  const [totalBurned, setTotalBurned] = useState(0);
  const [totalToHolders, setTotalToHolders] = useState(0);
  const [devRewardsSol, setDevRewardsSol] = useState(0);
  const { toast } = useToast();

  const performFlip = useCallback(() => {
    if (isFlipping) return;

    setIsFlipping(true);
    setShowResult(false);
    setCurrentResult(null);

    setTimeout(() => {
      const result = Math.random() > 0.5 ? "burn" : "holder";
      const amount = Math.floor(Math.random() * 50000) + 10000;
      const solValue = (Math.random() * 0.5 + 0.1); // 0.1 - 0.6 SOL per flip
      const devCutSol = solValue * 0.02; // 2% dev fee in SOL
      
      setCurrentResult(result);
      setIsFlipping(false);
      setShowResult(true);

      // Update history
      const newRecord: FlipRecord = {
        id: Date.now(),
        result,
        timestamp: new Date(),
      };
      setHistory((prev) => [...prev, newRecord]);

      // Update winners
      const newWinner: WinnerRecord = {
        id: Date.now(),
        type: result,
        wallet: result === "holder" ? MOCK_WALLETS[Math.floor(Math.random() * MOCK_WALLETS.length)] : undefined,
        amount,
        txHash: generateMockTxHash(),
        timestamp: new Date(),
      };
      setWinners((prev) => [...prev, newWinner]);

      // Update totals
      if (result === "burn") {
        setTotalBurned((prev) => prev + amount);
      } else {
        setTotalToHolders((prev) => prev + amount);
      }
      setDevRewardsSol((prev) => prev + devCutSol);

      toast({
        title: result === "burn" ? "🔥 Buyback & Burn!" : "🎁 Holder Wins!",
        description: `${amount.toLocaleString()} tokens ${result === "burn" ? "burned" : "sent to holder"}`,
      });

      setTimeout(() => {
        setShowResult(false);
      }, 3500);
    }, 2500);
  }, [isFlipping, toast]);

  const toggleAutoFlip = () => {
    setIsRunning((prev) => !prev);
    toast({
      title: isRunning ? "Auto-flip paused" : "Auto-flip resumed",
      description: isRunning ? "Click play to resume" : "Next flip in 2 minutes",
    });
  };

  const resetHistory = () => {
    setHistory([]);
    setWinners([]);
    setTotalBurned(0);
    setTotalToHolders(0);
    setDevRewardsSol(0);
    toast({ title: "Reset complete" });
  };

  return (
    <div className="min-h-screen relative">
      <CasinoBackground />
      <CasinoResult result={currentResult} isVisible={showResult} />

      <div className="relative z-10">
        {/* Top bar */}
        <div className="border-b border-border/80 bg-card/60 backdrop-blur-xl sticky top-0 z-40">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
                <Coins className="w-5 h-5 text-amber-900" />
              </div>
              <div>
                <h1 className="font-bold text-sm tracking-tight">COINFLIP</h1>
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  Powered by <SolanaLogo className="w-3 h-3 inline" /> Solana
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 border border-border">
                <SolanaLogo className="w-4 h-4" />
                <span className="font-mono text-xs font-semibold text-foreground">
                  {devRewardsSol.toFixed(3)}
                </span>
                <span className="text-[10px] text-muted-foreground">SOL</span>
              </div>
              
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/25">
                <div className="w-2 h-2 rounded-full bg-primary animate-live" />
                <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Live</span>
              </div>
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-6 md:py-8 max-w-6xl">
          {/* Rewards panel */}
          <div className="mb-8">
            <RewardsPanel 
              totalBurned={totalBurned}
              totalToHolders={totalToHolders}
              devRewardsSol={devRewardsSol}
              totalFlips={history.length}
            />
          </div>

          {/* Main game area */}
          <div className="grid lg:grid-cols-[1fr_auto_1fr] gap-6 lg:gap-10 items-start mb-8">
            {/* Left - Timer */}
            <div className="flex justify-center lg:justify-end order-2 lg:order-1">
              <div className="w-full max-w-[240px]">
                <CasinoTimer
                  seconds={FLIP_INTERVAL}
                  onComplete={performFlip}
                  isRunning={isRunning && !isFlipping}
                />
              </div>
            </div>

            {/* Center - Coin & Controls */}
            <div className="flex flex-col items-center gap-8 order-1 lg:order-2">
              <CasinoCoin isFlipping={isFlipping} result={currentResult} />
              
              {/* Controls */}
              <div className="flex flex-col items-center gap-4">
                <Button
                  onClick={performFlip}
                  disabled={isFlipping}
                  className="min-w-[160px] h-12 bg-gradient-to-r from-primary to-[#0ea87a] hover:from-primary/90 hover:to-[#0ea87a]/90 text-primary-foreground font-bold rounded-xl shadow-lg shadow-primary/25 transition-all hover:shadow-primary/40 hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
                >
                  <Zap className="w-5 h-5 mr-2" />
                  {isFlipping ? "Flipping..." : "Flip Now"}
                </Button>
                
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={toggleAutoFlip}
                    className="w-11 h-11 rounded-xl border-border bg-card hover:bg-muted transition-all hover:scale-105"
                  >
                    {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={resetHistory}
                    className="w-11 h-11 rounded-xl border-border bg-card hover:bg-muted transition-all hover:scale-105"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Right - Live Feed */}
            <div className="flex justify-center lg:justify-start order-3">
              <div className="w-full max-w-[280px]">
                <LiveFeed history={history} />
              </div>
            </div>
          </div>

          {/* Winners Panel */}
          <div className="mb-8">
            <WinnersPanel winners={winners} />
          </div>

          {/* How it works */}
          <div className="rounded-2xl p-5 bg-gradient-to-b from-card to-background border border-border">
            <div className="flex items-center gap-2 mb-4">
              <Info className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold">How It Works</span>
            </div>
            
            <div className="grid md:grid-cols-3 gap-3">
              <div className="flex gap-3 p-4 rounded-xl bg-ember/5 border border-ember/10 hover:border-ember/25 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-ember/15 flex items-center justify-center shrink-0">
                  <Flame className="w-5 h-5 text-ember" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-ember mb-1">Buyback & Burn</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Tokens bought from market and permanently burned.
                  </p>
                </div>
              </div>
              
              <div className="flex gap-3 p-4 rounded-xl bg-royal/5 border border-royal/10 hover:border-royal/25 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-royal/15 flex items-center justify-center shrink-0">
                  <Gift className="w-5 h-5 text-royal" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-royal mb-1">Random Holder</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Lucky token holder selected to receive reward.
                  </p>
                </div>
              </div>

              <div className="flex gap-3 p-4 rounded-xl bg-primary/5 border border-primary/10 hover:border-primary/25 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                  <Zap className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-primary mb-1">Auto Flip</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Automatic coin flip every 2 minutes, 24/7.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <footer className="text-center mt-10 pb-6">
            <div className="flex items-center justify-center gap-2 mb-2">
              <SolanaLogo className="w-4 h-4" />
              <span className="text-xs text-muted-foreground">Built on Solana</span>
            </div>
            <p className="text-[10px] text-muted-foreground/60">
              50/50 odds • 2% dev fee • All transactions verifiable on Solscan
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default Index;

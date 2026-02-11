import { cn } from "@/lib/utils";
import usdcCoinLogo from "@/assets/usdc-coin-logo.png";

interface CasinoCoinProps {
  isFlipping: boolean;
  result: "burn" | "holder" | null;
}

const CasinoCoin = ({ isFlipping, result }: CasinoCoinProps) => {
  return (
    <div className="relative flex flex-col items-center">
      {/* Ambient glow */}
      <div className={cn(
        "absolute w-[400px] h-[400px] md:w-[520px] md:h-[520px] rounded-full transition-all duration-700 blur-[120px]",
        isFlipping && "animate-pulse scale-110",
        result === "burn" 
          ? "bg-gradient-radial from-ember/50 to-transparent" 
          : result === "holder" 
            ? "bg-gradient-radial from-blue-500/50 to-transparent"
            : "bg-gradient-radial from-blue-400/30 to-transparent"
      )} />

      {/* Coin container - bigger */}
      <div 
        className="relative w-64 h-64 md:w-80 md:h-80 lg:w-96 lg:h-96"
        style={{ perspective: "1200px" }}
      >
        {/* Particle rings when flipping */}
        {isFlipping && (
          <>
            <div className="absolute inset-[-10%] rounded-full border-2 border-blue-400/60 animate-expand" />
            <div className="absolute inset-[-5%] rounded-full border border-blue-300/40 animate-expand [animation-delay:0.2s]" />
            <div className="absolute inset-0 rounded-full border border-blue-400/30 animate-expand [animation-delay:0.4s]" />
          </>
        )}

        {/* Main coin wrapper */}
        <div
          className={cn(
            "absolute inset-0 cursor-pointer",
            isFlipping && "animate-coin-flip"
          )}
          style={{ 
            transformStyle: "preserve-3d",
          }}
        >
          {/* Coin image */}
          <img 
            src={usdcCoinLogo} 
            alt="USDC Coin" 
            className={cn(
              "w-full h-full object-contain",
              !isFlipping && "animate-float-premium",
            )}
            style={{
              filter: `brightness(1.15) contrast(1.05) drop-shadow(0 0 40px rgba(39,117,202,0.5)) drop-shadow(0 0 80px rgba(39,117,202,0.3))`,
            }}
          />

          {/* Extra shine overlay */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-[15%] rounded-full bg-gradient-to-tr from-transparent via-white/15 to-transparent shimmer" />
          </div>
        </div>

        {/* Result glow */}
        {result && !isFlipping && (
          <div className={cn(
            "absolute -inset-12 rounded-full blur-3xl animate-pulse pointer-events-none",
            result === "burn" ? "bg-ember/30" : "bg-blue-500/30"
          )} />
        )}
      </div>

      {/* Ground shadow */}
      <div 
        className="w-48 h-7 md:w-56 md:h-8 rounded-[50%] bg-black/50 blur-xl mt-8 animate-shadow-pulse"
      />
      
      {/* Status badge */}
      <div className={cn(
        "mt-8 px-6 py-2.5 rounded-full text-[11px] font-bold uppercase tracking-[0.2em] transition-all duration-500 border",
        isFlipping 
          ? "bg-primary/15 text-primary border-primary/30 shadow-[0_0_25px_hsl(209_66%_47%_/_0.25)]"
          : result === "burn"
            ? "bg-ember/15 text-ember border-ember/30 shadow-[0_0_25px_hsl(14_100%_57%_/_0.25)]"
            : result === "holder"
              ? "bg-blue-500/15 text-blue-400 border-blue-500/30 shadow-[0_0_25px_rgba(39,117,202,0.25)]"
              : "bg-muted/30 text-muted-foreground border-border"
      )}>
        {isFlipping ? "Flipping..." : result === "burn" ? "HEADS - Burn!" : result === "holder" ? "TAILS - Winner!" : "Ready to Flip"}
      </div>
    </div>
  );
};

export default CasinoCoin;

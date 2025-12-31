import { cn } from "@/lib/utils";

interface CasinoCoinProps {
  isFlipping: boolean;
  result: "burn" | "holder" | null;
}

const CasinoCoin = ({ isFlipping, result }: CasinoCoinProps) => {
  return (
    <div className="relative flex flex-col items-center">
      {/* Ambient glow */}
      <div className={cn(
        "absolute w-[300px] h-[300px] md:w-[400px] md:h-[400px] rounded-full transition-all duration-700 blur-[100px]",
        isFlipping && "animate-pulse scale-110",
        result === "burn" 
          ? "bg-gradient-radial from-ember/40 to-transparent" 
          : result === "holder" 
            ? "bg-gradient-radial from-royal/40 to-transparent"
            : "bg-gradient-radial from-amber-500/25 to-transparent"
      )} />

      {/* Coin container */}
      <div 
        className="relative w-48 h-48 md:w-60 md:h-60 lg:w-72 lg:h-72"
        style={{ perspective: "1000px" }}
      >
        {/* Particle rings when flipping */}
        {isFlipping && (
          <>
            <div className="absolute inset-[-10%] rounded-full border-2 border-amber-400/60 animate-expand" />
            <div className="absolute inset-[-5%] rounded-full border border-amber-300/40 animate-expand [animation-delay:0.2s]" />
            <div className="absolute inset-0 rounded-full border border-amber-400/30 animate-expand [animation-delay:0.4s]" />
          </>
        )}

        {/* Main coin wrapper */}
        <div
          className={cn(
            "absolute inset-0 cursor-pointer transition-transform",
            isFlipping ? "animate-coin-flip" : "animate-coin-idle"
          )}
          style={{ transformStyle: "preserve-3d" }}
        >
          {/* Coin edge/rim */}
          <div 
            className="absolute inset-[3%] rounded-full"
            style={{
              background: "linear-gradient(135deg, #c9a227 0%, #8b6914 30%, #574109 60%, #8b6914 100%)",
              transform: "translateZ(-10px)",
              boxShadow: "inset 0 0 30px rgba(0,0,0,0.8)"
            }}
          />

          {/* Coin face - front */}
          <div 
            className="absolute inset-0 rounded-full overflow-hidden"
            style={{
              background: `
                radial-gradient(ellipse 120% 80% at 30% 20%, #fff8dc 0%, transparent 40%),
                radial-gradient(ellipse 100% 100% at 50% 50%, #ffd700 0%, #daa520 40%, #b8860b 70%, #8b6914 100%)
              `,
              boxShadow: `
                inset 0 8px 30px rgba(255,255,255,0.5),
                inset 0 -8px 30px rgba(0,0,0,0.4),
                0 30px 60px -10px rgba(0,0,0,0.5),
                0 0 120px rgba(255,215,0,0.3)
              `,
              transform: "translateZ(10px)"
            }}
          >
            {/* Outer border ring */}
            <div 
              className="absolute inset-[4%] rounded-full"
              style={{
                border: "4px solid rgba(139, 105, 20, 0.4)",
                boxShadow: "inset 0 2px 4px rgba(255,255,255,0.2)"
              }}
            />

            {/* Inner raised disc */}
            <div 
              className="absolute inset-[12%] rounded-full flex items-center justify-center"
              style={{
                background: `
                  radial-gradient(ellipse 100% 80% at 35% 25%, #fffacd 0%, #ffd700 20%, #eec900 40%, #daa520 60%, #b8860b 85%, #8b6914 100%)
                `,
                boxShadow: `
                  inset 0 6px 20px rgba(255,255,255,0.6),
                  inset 0 -6px 20px rgba(0,0,0,0.3),
                  0 4px 15px rgba(0,0,0,0.3)
                `
              }}
            >
              {/* Inner ring */}
              <div 
                className="absolute inset-[6%] rounded-full"
                style={{ border: "2px solid rgba(139, 105, 20, 0.25)" }}
              />

              {/* Dollar sign */}
              <div className="flex flex-col items-center justify-center">
                <span 
                  className="text-6xl md:text-7xl lg:text-8xl font-black leading-none select-none"
                  style={{
                    fontFamily: "'Space Grotesk', sans-serif",
                    color: "#7a5c10",
                    textShadow: `
                      2px 2px 0 rgba(255,255,255,0.4),
                      -1px -1px 0 rgba(0,0,0,0.2),
                      0 4px 8px rgba(0,0,0,0.15)
                    `
                  }}
                >
                  $
                </span>
                <span 
                  className="text-[8px] md:text-[10px] font-bold tracking-[0.4em] uppercase select-none mt-1"
                  style={{ 
                    color: "#7a5c10",
                    textShadow: "1px 1px 0 rgba(255,255,255,0.3)"
                  }}
                >
                  FLIP
                </span>
              </div>

              {/* Decorative dots around edge */}
              {[...Array(12)].map((_, i) => (
                <div
                  key={i}
                  className="absolute w-1.5 h-1.5 md:w-2 md:h-2 rounded-full"
                  style={{
                    background: "rgba(139, 105, 20, 0.3)",
                    top: `${50 + 42 * Math.sin((i * Math.PI * 2) / 12)}%`,
                    left: `${50 + 42 * Math.cos((i * Math.PI * 2) / 12)}%`,
                    transform: "translate(-50%, -50%)",
                    boxShadow: "inset 0 1px 2px rgba(0,0,0,0.2)"
                  }}
                />
              ))}
            </div>

            {/* Sweeping shine */}
            <div className="absolute inset-0 overflow-hidden rounded-full pointer-events-none">
              <div 
                className={cn("absolute inset-0", !isFlipping && "animate-shine")}
                style={{
                  background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.6) 50%, transparent 60%)",
                  transform: "translateX(-100%)"
                }}
              />
            </div>

            {/* Top glare */}
            <div 
              className="absolute top-[5%] left-[20%] right-[20%] h-[18%] rounded-full pointer-events-none"
              style={{
                background: "linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.1) 60%, transparent 100%)"
              }}
            />
          </div>
        </div>

        {/* Result glow */}
        {result && !isFlipping && (
          <div className={cn(
            "absolute -inset-8 rounded-full blur-3xl animate-pulse pointer-events-none",
            result === "burn" ? "bg-ember/40" : "bg-royal/40"
          )} />
        )}
      </div>

      {/* Ground shadow */}
      <div 
        className="w-32 h-5 md:w-40 md:h-6 rounded-[50%] bg-black/50 blur-xl mt-10 animate-shadow-pulse"
      />
      
      {/* Status badge */}
      <div className={cn(
        "mt-8 px-5 py-2 rounded-full text-[10px] font-bold uppercase tracking-[0.15em] transition-all duration-500 border",
        isFlipping 
          ? "bg-primary/15 text-primary border-primary/30 shadow-[0_0_20px_hsl(160_84%_39%_/_0.2)]"
          : result === "burn"
            ? "bg-ember/15 text-ember border-ember/30 shadow-[0_0_20px_hsl(14_100%_57%_/_0.2)]"
            : result === "holder"
              ? "bg-royal/15 text-royal border-royal/30 shadow-[0_0_20px_hsl(265_70%_58%_/_0.2)]"
              : "bg-muted/30 text-muted-foreground border-border"
      )}>
        {isFlipping ? "Flipping..." : result === "burn" ? "Burned!" : result === "holder" ? "Winner!" : "Ready to Flip"}
      </div>
    </div>
  );
};

export default CasinoCoin;
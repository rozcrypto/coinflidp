import { cn } from "@/lib/utils";

interface CasinoCoinProps {
  isFlipping: boolean;
  result: "burn" | "holder" | null;
}

const CasinoCoin = ({ isFlipping, result }: CasinoCoinProps) => {
  return (
    <div className="relative flex flex-col items-center">
      {/* Coin container */}
      <div 
        className="relative w-40 h-40 md:w-52 md:h-52 lg:w-60 lg:h-60"
        style={{ perspective: "1000px" }}
      >
        {/* Ambient glow */}
        <div className={cn(
          "absolute -inset-8 rounded-full blur-[60px] transition-all duration-700",
          isFlipping && "animate-pulse scale-125",
          result === "burn" 
            ? "bg-ember/30" 
            : result === "holder" 
              ? "bg-royal/30"
              : "bg-amber-500/20"
        )} />

        {/* Flip rings */}
        {isFlipping && (
          <>
            <div className="absolute inset-0 rounded-full border-2 border-amber-400/60 animate-expand" />
            <div className="absolute inset-0 rounded-full border border-amber-400/40 animate-expand [animation-delay:0.2s]" />
            <div className="absolute inset-0 rounded-full border border-amber-400/20 animate-expand [animation-delay:0.4s]" />
          </>
        )}

        {/* Main coin */}
        <div
          className={cn(
            "absolute inset-0 rounded-full cursor-pointer",
            isFlipping ? "animate-coin-flip" : "animate-coin-idle"
          )}
          style={{ transformStyle: "preserve-3d" }}
        >
          {/* Edge (thickness) */}
          <div 
            className="absolute inset-0 rounded-full"
            style={{
              background: "linear-gradient(180deg, #c9a227 0%, #8b6914 40%, #5a4510 100%)",
              transform: "translateZ(-6px)",
              boxShadow: "inset 0 0 40px rgba(0,0,0,0.6)"
            }}
          />

          {/* Front face */}
          <div 
            className="absolute inset-0 rounded-full overflow-hidden"
            style={{
              background: "conic-gradient(from 120deg, #ffd700 0%, #ffec8b 10%, #daa520 25%, #b8860b 40%, #cd9b1d 55%, #ffd700 70%, #ffec8b 85%, #ffd700 100%)",
              boxShadow: `
                inset 0 4px 16px rgba(255,255,255,0.4),
                inset 0 -4px 16px rgba(0,0,0,0.3),
                0 20px 60px rgba(0,0,0,0.5),
                0 0 80px rgba(255,215,0,0.25)
              `,
              transform: "translateZ(6px)"
            }}
          >
            {/* Outer ring detail */}
            <div className="absolute inset-[5%] rounded-full border-[3px] border-amber-900/30" />
            <div className="absolute inset-[8%] rounded-full border border-amber-800/20" />
            
            {/* Inner raised area */}
            <div 
              className="absolute inset-[12%] rounded-full"
              style={{
                background: "radial-gradient(ellipse at 30% 20%, #fff9c4 0%, #ffd700 20%, #daa520 50%, #b8860b 80%, #8b6914 100%)",
                boxShadow: "inset 0 4px 12px rgba(255,255,255,0.5), inset 0 -4px 12px rgba(0,0,0,0.25)"
              }}
            >
              {/* Inner ring */}
              <div className="absolute inset-[8%] rounded-full border-2 border-amber-800/20" />
              
              {/* Center content */}
              <div className="absolute inset-0 flex items-center justify-center flex-col">
                <span 
                  className="text-5xl md:text-6xl lg:text-7xl font-black leading-none"
                  style={{
                    color: "#8b6914",
                    textShadow: "2px 2px 0 rgba(255,255,255,0.3), -1px -1px 0 rgba(0,0,0,0.2)",
                    fontFamily: "Inter, sans-serif"
                  }}
                >
                  $
                </span>
                <span 
                  className="text-[9px] md:text-[11px] font-bold tracking-[0.3em] uppercase"
                  style={{ color: "#8b6914" }}
                >
                  FLIP
                </span>
              </div>

              {/* Edge decorations */}
              {[...Array(12)].map((_, i) => (
                <div
                  key={i}
                  className="absolute w-1 h-1 md:w-1.5 md:h-1.5 rounded-full bg-amber-900/25"
                  style={{
                    top: `${50 + 42 * Math.sin((i * Math.PI * 2) / 12)}%`,
                    left: `${50 + 42 * Math.cos((i * Math.PI * 2) / 12)}%`,
                    transform: "translate(-50%, -50%)"
                  }}
                />
              ))}
            </div>

            {/* Sweeping shine */}
            <div className="absolute inset-0 overflow-hidden rounded-full">
              <div 
                className={cn("absolute top-0 left-0 h-full", !isFlipping && "animate-shine")}
                style={{
                  background: "linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.45) 50%, transparent 70%)",
                  width: "45%"
                }}
              />
            </div>

            {/* Top glare */}
            <div 
              className="absolute top-[4%] left-[18%] right-[18%] h-[20%] rounded-full"
              style={{
                background: "linear-gradient(180deg, rgba(255,255,255,0.45) 0%, transparent 100%)"
              }}
            />
          </div>
        </div>

        {/* Result glow overlay */}
        {result && !isFlipping && (
          <div className={cn(
            "absolute -inset-4 rounded-full blur-2xl animate-pulse-ring pointer-events-none",
            result === "burn" 
              ? "bg-ember/35"
              : "bg-royal/35"
          )} />
        )}
      </div>

      {/* Ground shadow */}
      <div 
        className="w-24 h-3 md:w-32 md:h-4 rounded-[50%] bg-black/40 blur-lg mt-6 animate-shadow-pulse"
      />
    </div>
  );
};

export default CasinoCoin;

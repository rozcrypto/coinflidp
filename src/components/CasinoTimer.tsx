import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Timer } from "lucide-react";

interface CasinoTimerProps {
  seconds: number;
  onComplete: () => void;
  isRunning: boolean;
}

const CasinoTimer = ({ seconds, onComplete, isRunning }: CasinoTimerProps) => {
  const [timeLeft, setTimeLeft] = useState(seconds);

  useEffect(() => {
    setTimeLeft(seconds);
  }, [seconds]);

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          onComplete();
          return seconds;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, seconds, onComplete]);

  const minutes = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  const progress = ((seconds - timeLeft) / seconds) * 100;
  const isLowTime = timeLeft <= 15;
  const isCritical = timeLeft <= 5;

  return (
    <div className={cn(
      "relative rounded-2xl p-5 transition-all duration-500 overflow-hidden",
      "bg-gradient-to-b from-card to-background border",
      isCritical 
        ? "border-primary/50 glow-green" 
        : isLowTime 
          ? "border-primary/30" 
          : "border-border"
    )}>
      {/* Background pulse for critical time */}
      {isCritical && (
        <div className="absolute inset-0 bg-primary/5 animate-pulse" />
      )}

      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Timer className={cn(
              "w-4 h-4 transition-colors",
              isCritical ? "text-primary" : "text-muted-foreground"
            )} />
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
              Next Flip
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={cn(
              "w-2 h-2 rounded-full transition-all",
              isRunning ? "bg-primary animate-live" : "bg-muted-foreground"
            )} />
            <span className={cn(
              "text-[9px] font-semibold uppercase tracking-wider",
              isRunning ? "text-primary" : "text-muted-foreground"
            )}>
              {isRunning ? "AUTO" : "PAUSED"}
            </span>
          </div>
        </div>

        {/* Time display */}
        <div className={cn(
          "font-mono text-5xl font-bold tracking-tight text-center mb-4 transition-all duration-300",
          isCritical 
            ? "text-primary text-glow-green" 
            : isLowTime 
              ? "text-primary" 
              : "text-foreground"
        )}>
          <span className="inline-block min-w-[1.5ch]">{minutes}</span>
          <span className={cn("mx-0.5", isCritical && "animate-pulse")}>:</span>
          <span className="inline-block min-w-[2ch]">{secs.toString().padStart(2, "0")}</span>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
          <div 
            className={cn(
              "h-full rounded-full transition-all duration-1000 ease-linear",
              isCritical 
                ? "bg-gradient-to-r from-primary to-[#9945FF] shadow-[0_0_12px_hsl(160_84%_39%_/_0.6)]" 
                : isLowTime 
                  ? "bg-primary" 
                  : "bg-muted-foreground/30"
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default CasinoTimer;

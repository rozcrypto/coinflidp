import { Flame, Gift, Coins, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface RewardsPanelProps {
  totalBurned: number;
  totalToHolders: number;
  devRewardsSol: number;
  totalFlips: number;
}

// Solana Logo Component
const SolanaLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 397.7 311.7" className={className} fill="currentColor">
    <linearGradient id="solana-gradient" x1="360.879" y1="351.455" x2="141.213" y2="-69.294" gradientTransform="matrix(1 0 0 -1 0 314)" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#00FFA3"/>
      <stop offset="1" stopColor="#DC1FFF"/>
    </linearGradient>
    <path fill="url(#solana-gradient)" d="M64.6,237.9c2.4-2.4,5.7-3.8,9.2-3.8h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,237.9z"/>
    <path fill="url(#solana-gradient)" d="M64.6,3.8C67.1,1.4,70.4,0,73.8,0h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,3.8z"/>
    <path fill="url(#solana-gradient)" d="M333.1,120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8,0-8.7,7-4.6,11.1l62.7,62.7c2.4,2.4,5.7,3.8,9.2,3.8h317.4c5.8,0,8.7-7,4.6-11.1L333.1,120.1z"/>
  </svg>
);

const RewardsPanel = ({ totalBurned, totalToHolders, devRewardsSol, totalFlips }: RewardsPanelProps) => {
  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  const stats = [
    {
      icon: Flame,
      label: "Total Burned",
      value: formatNumber(totalBurned),
      subValue: "tokens",
      color: "text-ember",
      bgColor: "bg-ember/10",
      borderColor: "border-ember/20",
      hoverBorder: "hover:border-ember/40",
      iconGlow: "drop-shadow-[0_0_8px_hsl(14_100%_57%_/_0.5)]",
    },
    {
      icon: Gift,
      label: "To Holders",
      value: formatNumber(totalToHolders),
      subValue: "tokens",
      color: "text-royal",
      bgColor: "bg-royal/10",
      borderColor: "border-royal/20",
      hoverBorder: "hover:border-royal/40",
      iconGlow: "drop-shadow-[0_0_8px_hsl(265_70%_58%_/_0.5)]",
    },
    {
      icon: null, // Will use Solana logo
      label: "Dev Rewards",
      value: devRewardsSol.toFixed(3),
      subValue: "SOL",
      color: "text-[#14F195]",
      bgColor: "bg-[#14F195]/10",
      borderColor: "border-[#14F195]/20",
      hoverBorder: "hover:border-[#14F195]/40",
      iconGlow: "drop-shadow-[0_0_8px_hsl(160_90%_51%_/_0.5)]",
      isSolana: true,
    },
    {
      icon: TrendingUp,
      label: "Total Flips",
      value: totalFlips.toString(),
      subValue: "rounds",
      color: "text-accent",
      bgColor: "bg-accent/10",
      borderColor: "border-accent/20",
      hoverBorder: "hover:border-accent/40",
      iconGlow: "drop-shadow-[0_0_8px_hsl(45_100%_50%_/_0.5)]",
    },
  ];

  return (
    <div className="w-full">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
        {stats.map((stat, index) => (
          <div
            key={stat.label}
            className={cn(
              "group relative rounded-xl p-4 md:p-5 border transition-all duration-300 cursor-default overflow-hidden",
              "bg-gradient-to-b from-card to-background",
              stat.borderColor,
              stat.hoverBorder
            )}
            style={{ animationDelay: `${index * 50}ms` }}
          >
            {/* Hover glow */}
            <div className={cn(
              "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl",
              stat.bgColor
            )} />
            
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-3">
                <div className={cn(
                  "w-9 h-9 rounded-lg flex items-center justify-center transition-transform duration-300 group-hover:scale-110",
                  stat.bgColor
                )}>
                  {stat.isSolana ? (
                    <SolanaLogo className={cn("w-5 h-5", stat.iconGlow)} />
                  ) : (
                    stat.icon && <stat.icon className={cn("w-4 h-4", stat.color, stat.iconGlow)} />
                  )}
                </div>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {stat.label}
                </span>
              </div>
              
              <div className="flex items-baseline gap-1.5">
                <span className={cn("font-mono text-2xl md:text-3xl font-bold tracking-tight", stat.color)}>
                  {stat.value}
                </span>
                <span className="text-[10px] text-muted-foreground font-medium">
                  {stat.subValue}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RewardsPanel;

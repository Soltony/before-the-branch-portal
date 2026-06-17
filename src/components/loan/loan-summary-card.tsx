
'use client';

import { useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Skeleton } from '../ui/skeleton';

interface LoanSummaryCardProps {
  maxLoanLimit: number;
  availableToBorrow: number;
  color?: string;
  isLoading?: boolean;
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', { style: 'decimal' }).format(amount) + ' ETB';
};

export function LoanSummaryCard({ maxLoanLimit, availableToBorrow, color = '#fdb913', isLoading = false }: LoanSummaryCardProps) {
    const [isMaxLimitVisible, setIsMaxLimitVisible] = useState(true);
    const [isAvailableVisible, setIsAvailableVisible] = useState(true);

    const toggleMaxLimitVisibility = () => {
        setIsMaxLimitVisible(!isMaxLimitVisible);
    }
    
    const toggleAvailableVisibility = () => {
        setIsAvailableVisible(!isAvailableVisible);
    }

    const renderAmount = (amount: number, isVisible: boolean) => {
        if (!isVisible) {
            return '******';
        }
        return formatCurrency(amount);
    }

  return (
    <div 
      className="relative p-6 rounded-2xl text-primary-foreground shadow-lg flex flex-col justify-center min-h-[140px] overflow-hidden"
      style={{ backgroundColor: color }}
    >
      <div className="absolute inset-0 z-0 opacity-10">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="hex-pattern" patternUnits="userSpaceOnUse" width="40" height="69.28" patternTransform="scale(1) rotate(0)">
              <polygon points="20,0 40,17.32 40,51.96 20,69.28 0,51.96 0,17.32" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#hex-pattern)"/>
        </svg>
      </div>

      <div className="relative z-10 flex flex-row items-center justify-between w-full">
        {/* Left Side: Max Limit */}
        <div className="text-left">
            <div className="flex items-center gap-2">
                <p className="text-sm opacity-80 mb-1">Max Limit</p>
                <button onClick={(e) => { e.stopPropagation(); toggleMaxLimitVisibility(); }} className="text-primary-foreground focus:outline-none">
                    {isMaxLimitVisible ? <Eye className="h-4 w-4 opacity-80" /> : <EyeOff className="h-4 w-4 opacity-80" />}
                </button>
            </div>
             {isLoading ? <Skeleton className="h-8 w-32 bg-white/20" /> : <p className="text-xl md:text-2xl font-semibold tracking-tight">{renderAmount(maxLoanLimit, isMaxLimitVisible)}</p>}
        </div>

        {/* Right Side: Available */}
        <div className="text-right">
            <div className="flex items-center gap-2 justify-end">
                <p className="text-sm opacity-80 mb-1">Available</p>
                 <button onClick={(e) => { e.stopPropagation(); toggleAvailableVisibility(); }} className="text-primary-foreground focus:outline-none">
                    {isAvailableVisible ? <Eye className="h-4 w-4 opacity-80" /> : <EyeOff className="h-4 w-4 opacity-80" />}
                </button>
            </div>
             {isLoading ? <Skeleton className="h-8 w-40 bg-white/20 ml-auto" /> : <p className="text-xl md:text-2xl font-semibold tracking-tight">{renderAmount(availableToBorrow, isAvailableVisible)}</p>}
        </div>
      </div>
    </div>
  );
}

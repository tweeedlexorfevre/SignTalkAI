import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'onStage';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-[var(--signal)] text-[var(--signal-ink)] hover:brightness-105 active:scale-[0.98] disabled:opacity-60',
  secondary:
    'border border-line bg-transparent text-ink hover:border-[var(--line-strong)] hover:bg-surface-muted disabled:opacity-60',
  ghost: 'text-ink hover:bg-surface-muted disabled:opacity-50',
  danger: 'border border-line bg-surface text-danger hover:bg-danger-soft disabled:opacity-60',
  onStage:
    'border border-white/20 bg-white/10 text-white backdrop-blur hover:bg-white/20 disabled:opacity-60',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}) {
  const sizes = {
    sm: 'h-9 gap-1.5 px-3.5 text-sm',
    md: 'h-11 gap-2 px-5 text-sm',
    lg: 'h-13 gap-2 px-6 text-base',
  };
  return (
    <button
      type="button"
      className={`ui-btn ui-btn-${variant} inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full font-semibold whitespace-nowrap transition-all disabled:cursor-not-allowed ${sizes[size]} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`ui-card rounded-[24px] border border-line bg-surface shadow-card ${className}`}
    >
      {children}
    </div>
  );
}

export function Percent({ value }: { value: number }) {
  return <span className="tabular-nums">{Math.round(value * 100)}%</span>;
}

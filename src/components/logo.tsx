export function Logo({ size = 28, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="9" fill="var(--accent)" />
        <path d="M11.5 10.5 16.5 8v16" stroke="var(--accent-fg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <circle cx="21.5" cy="21.5" r="2.4" fill="var(--accent-fg)" opacity="0.9" />
      </svg>
      {withWordmark && <span className="text-[15px] font-semibold tracking-tight">ONECRM</span>}
    </span>
  );
}

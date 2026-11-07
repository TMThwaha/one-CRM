import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="hidden flex-col justify-between border-r border-border bg-surface-2 p-12 lg:flex">
        <Logo size={32} />
        <div className="max-w-md space-y-5">
          <h2 className="text-3xl leading-tight font-semibold tracking-tight">
            Customers, deals and daily work, in one connected place.
          </h2>
          <ul className="space-y-3 text-[15px] text-muted">
            <li>Every contact, company, lead and deal shares one timeline.</li>
            <li>Roles decide who sees what — enforced in the database, not just the screen.</li>
            <li>Every change is written to an audit trail you can search.</li>
          </ul>
        </div>
        <p className="text-xs text-faint">ONECRM · Early build</p>
      </aside>
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

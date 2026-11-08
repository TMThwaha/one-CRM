"use client";

import {
  Activity, BarChart3, Bell, Bot, Building2, CreditCard, Globe2, LayoutDashboard, LogOut, Menu as MenuIcon, Plug,
  Plus, ScrollText, Settings, ShieldCheck, UserCog, Users, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Logo } from "@/components/logo";
import { MenuItem, Popover, ThemeToggle } from "@/components/shell/app-shell";
import { Avatar, Button, cn } from "@/components/ui";
import { post } from "@/lib/api";

interface NavItem { href: string; label: string; icon: LucideIcon; exact?: boolean }

const NAV: NavItem[] = [
  { href: "/super-admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/super-admin/companies", label: "Companies", icon: Building2 },
  { href: "/super-admin/companies/new", label: "Create Company", icon: Plus },
  { href: "/super-admin/administrators", label: "Company Administrators", icon: UserCog },
  { href: "/super-admin/users", label: "Users", icon: Users },
  { href: "/super-admin/countries", label: "Countries and Regions", icon: Globe2 },
  { href: "/super-admin/plans", label: "Subscriptions and Plans", icon: CreditCard },
  { href: "/super-admin/audit", label: "Audit Logs", icon: ScrollText },
  { href: "/super-admin/security", label: "Security", icon: ShieldCheck },
];

/** Shown so the panel never pretends to have features it does not have yet. */
const PLANNED: { label: string; icon: LucideIcon }[] = [
  { label: "Platform Usage", icon: BarChart3 },
  { label: "Global AI Settings", icon: Bot },
  { label: "Integration Management", icon: Plug },
  { label: "Platform Notifications", icon: Bell },
  { label: "System Health", icon: Activity },
  { label: "Platform Settings", icon: Settings },
];

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const pathname = usePathname();
  const isCreate = item.href === "/super-admin/companies/new";
  const active = item.exact
    ? pathname === item.href
    : isCreate
      ? pathname === item.href
      : pathname === item.href || (pathname.startsWith(item.href + "/") && !pathname.startsWith("/super-admin/companies/new"));
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-fg",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {item.label}
    </Link>
  );
}

export function PlatformShell({
  user,
  mfaEnabled,
  children,
}: {
  user: { name: string; email: string };
  mfaEnabled: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const signOut = async () => {
    await post("/auth/logout").catch(() => {});
    router.replace("/login");
    router.refresh();
  };

  const sidebar = (
    <nav aria-label="Platform" className="flex h-full flex-col gap-1 overflow-y-auto p-3">
      <div className="px-2 pt-1 pb-1"><Logo /></div>
      <p className="mx-2 mb-3 inline-flex w-fit items-center gap-1.5 rounded-md bg-accent-soft px-2 py-0.5 text-[11px] font-semibold tracking-wider text-accent uppercase">
        <ShieldCheck className="h-3 w-3" aria-hidden /> Platform control
      </p>
      <div className="space-y-0.5">
        {NAV.map((i) => <NavLink key={i.href} item={i} onNavigate={() => setNavOpen(false)} />)}
      </div>
      <p className="mt-5 px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">Not built yet</p>
      <ul className="space-y-0.5">
        {PLANNED.map(({ label, icon: Icon }) => (
          <li key={label} title="Not built yet" className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-faint">
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-border bg-surface lg:block">{sidebar}</aside>
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setNavOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-surface shadow-pop">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur">
          <Button size="icon" variant="ghost" className="lg:hidden" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            <MenuIcon className="h-4 w-4" />
          </Button>
          <span className="hidden text-sm font-medium text-muted sm:inline">Global Super Admin</span>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Popover label="Account" trigger={<Avatar name={user.name} size={32} labelled />}>
              {(close) => (
                <>
                  <div className="px-2.5 py-2">
                    <p className="text-sm font-medium">{user.name}</p>
                    <p className="text-xs text-muted">{user.email}</p>
                  </div>
                  <div className="my-1 border-t border-border" />
                  <MenuItem icon={ShieldCheck} onClick={() => { close(); router.push("/super-admin/security"); }}>Security</MenuItem>
                  <MenuItem icon={LogOut} onClick={() => { close(); void signOut(); }}>Sign out</MenuItem>
                </>
              )}
            </Popover>
          </div>
        </header>
        {!mfaEnabled && (
          <div role="status" className="border-b border-warning/30 bg-warning-soft px-4 py-2 text-sm text-fg">
            This account controls the whole platform and has no second factor.{" "}
            <Link href="/super-admin/security" className="font-semibold underline">Turn on two-factor authentication</Link>.
          </div>
        )}
        <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}

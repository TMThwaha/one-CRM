import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-5xl font-semibold tracking-tight text-faint">404</p>
      <h1 className="text-lg font-semibold">We couldn&apos;t find that</h1>
      <p className="max-w-sm text-sm text-muted">It may have been deleted, or you may not have access to it.</p>
      <Link href="/dashboard" className="text-sm font-medium text-accent hover:underline">Back to dashboard</Link>
    </div>
  );
}

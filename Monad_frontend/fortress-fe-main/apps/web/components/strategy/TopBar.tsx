"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { FortressMark } from "@/components/ui/FortressMark";

// Profile also owns the legacy /portfolio and /saved routes (they redirect
// there, and /saved/[id] detail pages still live under /saved).
const NAV = [
  { label: "Prompt", href: "/prompt", roots: ["/prompt"] },
  { label: "Strategies", href: "/strategies", roots: ["/strategies"] },
  { label: "Board", href: "/board", roots: ["/board"] },
  { label: "Profile", href: "/profile", roots: ["/profile", "/portfolio", "/saved"] },
];

function isActive(pathname: string, roots: string[]) {
  return roots.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

export function TopBar() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  const [prevPathname, setPrevPathname] = useState(pathname);

  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMenuOpen(false);
  }

  // Close on outside click too — otherwise it can stay open behind whatever
  // the user interacts with next (e.g. the "/" action picker in the prompt
  // composer), overlapping instead of getting out of the way.
  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  return (
    <header ref={headerRef} className="relative flex-none border-b border-line-soft">
      <div className="mx-auto flex h-[54px] w-full max-w-[1320px] items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-4 sm:gap-10">
          <Link href="/prompt" className="group flex items-center gap-2 sm:gap-3">
            <div className="relative flex-none" style={{ width: (40 * 300) / 347.992, height: 40 }}>
              <FortressMark size={40} className="absolute inset-0 text-white transition-opacity duration-500 ease-in-out group-hover:opacity-0" />
              <FortressMark size={40} gradient className="absolute inset-0 opacity-0 transition-opacity duration-500 ease-in-out group-hover:opacity-100" />
            </div>
            <div className="relative flex items-center">
              <span className="text-[18px] font-bold tracking-tight text-white transition-opacity duration-500 ease-in-out group-hover:opacity-0">Fortress</span>
              <span className="absolute left-0 text-[18px] font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-[var(--color-green-bright)] to-[var(--color-gold)] opacity-0 transition-opacity duration-500 ease-in-out group-hover:opacity-100">Fortress</span>
            </div>
            <span className="rounded-full border border-line px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted">
              Beta
            </span>
          </Link>
          <nav className="hidden items-center gap-6 text-[13px] font-medium sm:flex">
            {NAV.map((item) => {
              const active = isActive(pathname, item.roots);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`transition-colors ${active ? "text-fg" : "text-muted hover:text-fg"}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            className="flex h-9 w-9 flex-none items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg sm:hidden"
          >
            {menuOpen ? (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            )}
          </button>
          {/* Rightmost — its dropdown anchors right-0 off this element, so it
              needs to be the true trailing element for that to align with
              the viewport edge rather than landing mid-header. */}
          <AccountMenu />
        </div>
      </div>

      {/* Mobile nav drawer — floats over the page (absolute + backdrop)
          instead of sitting in normal flow, which would push everything
          below the header down the moment it opens. */}
      {menuOpen && (
        <>
          <div
            aria-hidden
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 top-[54px] z-40 bg-black/50 backdrop-blur-sm sm:hidden"
          />
          <nav className="absolute inset-x-0 top-full z-50 flex flex-col gap-0.5 border-b border-line-soft bg-base px-4 py-2 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.6)] sm:hidden">
            {NAV.map((item) => {
              const active = isActive(pathname, item.roots);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-2.5 py-2.5 text-[14.5px] font-medium transition-colors ${
                    active ? "bg-surface-2 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </>
      )}
    </header>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { motion, AnimatePresence } from "framer-motion";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function WalletSvg({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 12h5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 12a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}

export function AccountMenu() {
  const router = useRouter();
  const { status, address, isConnected, signIn, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (status === "loading") {
    return <div className="h-[34px] w-[120px] rounded-full border border-white/10 bg-white/5 animate-pulse" />;
  }

  if (status !== "authenticated") {
    return (
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => signIn()}
        className="h-[34px] rounded-full bg-gradient-to-r from-white to-white/90 px-5 text-[13px] font-bold text-black shadow-[0_0_15px_rgba(255,255,255,0.2)] transition-all hover:shadow-[0_0_20px_rgba(255,255,255,0.4)]"
      >
        {isConnected ? "Sign in" : "Connect wallet"}
      </motion.button>
    );
  }

  const label = address ? shortAddress(address) : "Account";

  const handleCopy = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => setOpen((o) => !o)}
        className="flex h-[36px] flex-none items-center gap-2.5 whitespace-nowrap rounded-full border border-white/10 bg-white/5 pl-2.5 pr-3 text-[13px] font-medium text-white transition-all hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/20 sm:pr-4"
      >
        <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-white/10 text-white">
           <WalletSvg className="h-3.5 w-3.5" />
        </div>
        {/* Full address only from sm up — on a narrow phone this plus the
            logo/beta/hamburger on the same row has no room and would
            otherwise wrap onto a second line instead of fitting. */}
        <span className="mono hidden tracking-tight text-white/90 sm:inline">{label}</span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          className="text-[10px] text-white/40 ml-0.5"
        >
          ▾
        </motion.span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="absolute right-0 z-50 mt-3 w-[260px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[20px] border border-white/10 bg-[#0a0a0c]/80 p-2 shadow-[0_0_40px_-10px_rgba(255,255,255,0.05)] backdrop-blur-2xl"
          >
            {address && (
              <div className="mb-2 rounded-[16px] border border-white/5 bg-white/5 p-4">
                <div className="flex items-center gap-3.5 mb-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-white/10 to-white/5 border border-white/10 text-white">
                    <WalletSvg className="h-5 w-5" />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[14px] font-bold text-white/90">Connected</span>
                    <span className="mono text-[12px] text-white/40">{shortAddress(address)}</span>
                  </div>
                </div>
                
                <motion.button 
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={handleCopy}
                  className="group flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/5 px-3 py-2.5 text-[12.5px] font-medium text-white/60 transition-all hover:border-white/10 hover:bg-white/10 hover:text-white"
                >
                  <div className="flex items-center gap-2.5">
                    {copied ? (
                      <svg className="h-4 w-4 text-[#4ade80]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4 text-white/40 group-hover:text-white/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                    <span className={copied ? "text-[#4ade80]" : ""}>{copied ? "Address Copied" : "Copy Address"}</span>
                  </div>
                </motion.button>
              </div>
            )}
            
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => {
                setOpen(false);
                router.push("/profile");
              }}
              className="flex w-full items-center gap-2.5 rounded-[12px] px-4 py-3 text-left text-[13px] font-semibold text-white/70 transition-all hover:bg-white/5 hover:text-white"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              View Profile
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => {
                setOpen(false);
                signOut();
              }}
              className="flex w-full items-center gap-2.5 rounded-[12px] px-4 py-3 text-left text-[13px] font-semibold text-red/80 transition-all hover:bg-red/10 hover:text-red"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Disconnect Wallet
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

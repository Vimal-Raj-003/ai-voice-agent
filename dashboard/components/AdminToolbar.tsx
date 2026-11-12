"use client";

import {usePathname} from "next/navigation";
import ThemeToggle from "./ThemeToggle";

export default function AdminToolbar() {
  const pathname=usePathname()??"";
  // Assistant editors include theme controls in their own compact header.
  if(pathname.startsWith('/assistants/'))return null;
  return <div className="sticky top-0 z-30 flex h-12 items-center justify-end border-b border-[var(--surface-border)] px-8"
    style={{background:"var(--bg-base)"}}><ThemeToggle/></div>;
}

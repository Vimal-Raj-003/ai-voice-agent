import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Jilljill Voice — Voice AI Platform",
  description:
    "Inbound + outbound + bulk voice calling powered by LiveKit and a multi-LLM agent.",
};

// Inline boot script — runs before body renders so the correct theme
// attribute is on <html> on the very first paint, avoiding FOUC. Reads
// localStorage if the user has explicitly toggled, otherwise honours the OS
// preference. Storage key is intentionally inlined here (matches
// THEME_STORAGE_KEY in lib/theme.ts) because the script ships ahead of any
// JS module — keep them in sync.
const themeBootScript = `(function () {
  try {
    var stored = localStorage.getItem('jjv_theme');
    var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    var theme = stored && stored !== 'system' ? stored : (prefersLight ? 'light' : 'dark');
    document.documentElement.dataset.theme = theme;
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}

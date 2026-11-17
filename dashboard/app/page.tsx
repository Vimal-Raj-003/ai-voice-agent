"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  LayoutDashboardIcon,
  PhoneCallIcon,
  CalendarDaysIcon,
  CreditCardIcon,
  PackageIcon,
  ChartBarIcon,
  LanguageIcon,
  CpuChipIcon,
  CrmIntegrationIcon,
  CheckBadgeIcon,
  MinusIcon,
  PlusIcon,
  ChevronDownIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  MinusCircleIcon,
  BellIcon,
  EnvelopeIcon,
  MapPinIcon,
  IsoCertificateIcon,
  Bars3Icon,
  XMarkIcon,
  LinkedInIcon,
  CheckIcon,
  TargetIcon,
  SunIcon,
  MoonIcon,
  ArrowLeftIcon,
} from "@/components/landing/LandingIcons";
import { LeadAndDemoModal } from "@/components/landing/LeadAndDemoModal";
import { Chatbot } from "@/components/landing/Chatbot";
import { THEME_STORAGE_KEY, setTheme as persistGlobalTheme } from "@/lib/theme";
import landingStyles from "@/components/landing/LandingPage.module.css";

const AnimatedSection: React.FC<{
  children: React.ReactNode;
  className?: string;
  delay?: number;
}> = ({ children, className, delay = 0 }) => {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(element);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${className || ""} ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      }`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
};

const StatItem: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [hasAnimated, setHasAnimated] = useState(false);

  const numberMatch = value.match(/(\d+)/);
  const target = numberMatch ? parseInt(numberMatch[0], 10) : 0;
  const prefix = numberMatch ? value.substring(0, numberMatch.index) : "";
  const suffix =
    numberMatch && numberMatch.index !== undefined
      ? value.substring(numberMatch.index + numberMatch[0].length)
      : "";

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated) {
          setHasAnimated(true);
          let startTimestamp: number | null = null;
          const duration = 1800;
          const step = (timestamp: number) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            setCount(Math.floor(progress * target));
            if (progress < 1) {
              window.requestAnimationFrame(step);
            } else {
              setCount(target);
            }
          };
          window.requestAnimationFrame(step);
          observer.unobserve(element);
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasAnimated, target]);

  return (
    <div className="flex-1" ref={ref}>
      <p className="text-4xl md:text-5xl font-extrabold" style={{ color: "var(--jj-accent)" }}>
        {prefix}
        {count}
        {suffix}
      </p>
      <p className="text-base md:text-lg mt-2" style={{ color: "var(--jj-muted)" }}>
        {label}
      </p>
    </div>
  );
};

const PRODUCT_ROLES: Array<{ label: string; role: string }> = [
  { label: "Academy Assistant", role: "academy" },
  { label: "Appointment Booker", role: "appointment" },
  { label: "Clinic Assistant", role: "clinic" },
  { label: "Customer Support", role: "support" },
  { label: "IVR Assistant", role: "ivr" },
  { label: "Marketing Outreach", role: "marketing" },
  { label: "Outbound Sales", role: "sales" },
  { label: "Call Receptionist", role: "receptionist" },
  { label: "Eye Care Appointment", role: "vasan" },
];

export default function LandingPage() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [theme, setThemeState] = useState<"dark" | "light">("dark");
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [preselectedRole, setPreselectedRole] = useState<string | null>(null);
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);
  const [currentView, setCurrentView] = useState<"home" | "privacy">("home");
  const productDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      const initial: "dark" | "light" = stored === "light" ? "light" : "dark";
      setThemeState(initial);
      document.documentElement.dataset.theme = initial;
    } catch {
      setThemeState("dark");
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setThemeState(next);
    persistGlobalTheme(next);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        productDropdownRef.current &&
        !productDropdownRef.current.contains(event.target as Node)
      ) {
        setIsProductDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const openDemo = (role?: string | null) => {
    setPreselectedRole(role ?? null);
    setIsDemoModalOpen(true);
  };

  const whyItWorksData = [
    {
      icon: <ChatBubbleLeftRightIcon />,
      title: "Human-Grade Conversations, Real ROI",
      description:
        "Ultra-natural AI voice specialists that listen, handle objections, qualify leads, and book confirmed appointments straight into your calendar.",
    },
    {
      icon: <ClockIcon />,
      title: "Custom-Deployed in 2–3 Days",
      description:
        "We tailor your voice persona, domain knowledge, and call workflows end-to-end so your custom AI agent goes live in just 2 to 3 days.",
    },
    {
      icon: <CrmIntegrationIcon />,
      title: "Instant CRM & Telephony Sync",
      description:
        "Plug-and-play integration with HubSpot, Zoho, Pipedrive, SIP trunks, and WhatsApp/SMS follow-ups with zero manual effort.",
    },
    {
      icon: <LanguageIcon />,
      title: "Fluent Native Multilingual Voice",
      description:
        "Switch effortlessly mid-call across English, Tamil, Tanglish, Hindi, and regional languages with authentic local pronunciation.",
    },
    {
      icon: <ChartBarIcon />,
      title: "Live Transcripts & Call Intelligence",
      description:
        "Every conversation is transcribed in real time, summarized, and scored so your team closes warm opportunities faster.",
    },
    {
      icon: <CpuChipIcon />,
      title: "Sub-Second Real-Time Responsiveness",
      description:
        "Proprietary low-latency voice architecture with natural barge-in handling — callers feel like they are speaking with your best executive.",
    },
  ];

  const testimonialsData = [
    {
      quote:
        "Jill-Jill deployed our custom voice workflow in under 72 hours. We are booking qualified appointments around the clock while our closers focus purely on high-value deals.",
      name: "VP of Sales",
      title: "B2B SaaS Enterprise",
    },
    {
      quote:
        "Callers genuinely love how natural and polite the assistant sounds in both Tamil and English. We eliminated missed after-hours enquiries completely from day one.",
      name: "Operations Director",
      title: "Multi-Specialty Healthcare Group",
    },
    {
      quote:
        "We saw a 42% jump in qualified pipeline within the first month. Automatic CRM logging and instant call transcripts save our team hours every single day.",
      name: "Founder & CEO",
      title: "Growth & Performance Agency",
    },
    {
      quote:
        "The custom setup was effortless and the live voice quality blew our leadership team away. It scales from 10 calls to 10,000 calls without hiring bottlenecks.",
      name: "Chief Operating Officer",
      title: "Financial Services Leader",
    },
  ];

  const faqData = [
    {
      question: "How fast can you customize and deploy our AI Voice Agent?",
      answer:
        "Within just 2 to 3 days. We configure your custom scripts, brand knowledge base, multilingual greetings, telephony routing, and CRM webhooks end-to-end so your ready-to-work voice agent goes live immediately.",
    },
    {
      question: "Can callers speak naturally in regional languages or switch mid-call?",
      answer:
        "Yes. Our voice agents converse naturally in English, Tamil, Tanglish, Hindi, and more — automatically adapting to the caller's language and displaying live transcripts in real time.",
    },
    {
      question: "Do we need an engineering team to manage it?",
      answer:
        "Zero technical overhead required. Everything is delivered as a turnkey, customized voice solution with a clean executive dashboard to track calls, recordings, transcripts, and booked leads.",
    },
    {
      question: "What systems and CRMs does Jill-Jill connect with?",
      answer:
        "We connect seamlessly with HubSpot, Zoho, Pipedrive, Cal.com, Google Calendar, SIP phone numbers, and custom REST webhooks.",
    },
  ];

  return (
    <div
      className={`${landingStyles.landingRoot} font-sans`}
      data-jj-theme={theme}
    >
      {/* ── Fixed Header Navigation ──────────────────────────────────────────── */}
      <header
        className="py-2.5 px-4 sm:px-8 md:px-12 fixed top-0 left-0 right-0 backdrop-blur-md z-40 border-b"
        style={{
          backgroundColor: "var(--jj-header)",
          borderColor: "var(--jj-border)",
        }}
      >
        <div className="container mx-auto flex justify-between items-center">
          <button
            type="button"
            onClick={() => {
              setCurrentView("home");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="flex items-center gap-2 transition-transform duration-300 hover:-translate-y-px cursor-pointer"
            aria-label="Jill-Jill Home"
          >
            <BellIcon
              className={`w-6 h-6 ${landingStyles.bellRing}`}
              style={{ color: "var(--jj-logo)" }}
            />
            <span
              className="text-lg sm:text-xl font-bold tracking-wider"
              style={{ color: "var(--jj-logo)" }}
            >
              Jill-Jill
            </span>
          </button>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-5">
            <div ref={productDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setIsProductDropdownOpen(!isProductDropdownOpen)}
                className="flex items-center gap-1 text-sm font-medium transition-colors cursor-pointer"
                style={{ color: "var(--jj-muted)" }}
                aria-haspopup="true"
                aria-expanded={isProductDropdownOpen}
              >
                <span>PRODUCTS</span>
                <ChevronDownIcon
                  className={`w-4 h-4 transition-transform duration-200 ${
                    isProductDropdownOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {isProductDropdownOpen && (
                <div
                  className="absolute top-full right-0 mt-2 w-64 rounded-xl border shadow-2xl p-1.5 z-50 backdrop-blur-xl"
                  style={{
                    backgroundColor: "var(--jj-primary)",
                    borderColor: "var(--jj-border)",
                  }}
                >
                  <ul className="text-sm space-y-0.5">
                    {PRODUCT_ROLES.map((item) => (
                      <li key={item.role}>
                        <button
                          type="button"
                          onClick={() => {
                            setIsProductDropdownOpen(false);
                            openDemo(item.role);
                          }}
                          className="w-full text-left px-3.5 py-2 rounded-lg hover:bg-lime-500/15 transition-colors cursor-pointer"
                          style={{ color: "var(--jj-text)" }}
                        >
                          {item.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <Link
              href="/overview"
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold tracking-wider uppercase border transition-all duration-200 hover:-translate-y-px"
              style={{
                backgroundColor: "var(--jj-surface)",
                borderColor: "var(--jj-border)",
                color: "var(--jj-text)",
              }}
              title="Open Admin Dashboard"
            >
              <LayoutDashboardIcon className="w-4 h-4 text-[#9eff00]" />
              <span>DASHBOARD</span>
            </Link>

            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 rounded-full transition-colors cursor-pointer"
              style={{ color: "var(--jj-muted)" }}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <SunIcon className="w-5 h-5" />
              ) : (
                <MoonIcon className="w-5 h-5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => openDemo()}
              className="py-2 px-5 text-xs sm:text-sm font-bold uppercase text-black bg-[#9eff00] hover:bg-[#bfff40] transition-all duration-300 hover:scale-105 cursor-pointer"
              style={{
                clipPath:
                  "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)",
              }}
            >
              AUTOMATE YOUR SALES..
            </button>
          </div>

          {/* Mobile Header Controls */}
          <div className="flex items-center gap-2 md:hidden">
            <Link
              href="/overview"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border"
              style={{
                backgroundColor: "var(--jj-surface)",
                borderColor: "var(--jj-border)",
                color: "var(--jj-accent)",
              }}
            >
              <LayoutDashboardIcon className="w-3.5 h-3.5" />
              <span>DASHBOARD</span>
            </Link>
            <button
              type="button"
              onClick={toggleTheme}
              className="p-1.5 rounded-full"
              style={{ color: "var(--jj-muted)" }}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-1.5"
              style={{ color: "var(--jj-text)" }}
              aria-label="Toggle menu"
            >
              {isMobileMenuOpen ? <XMarkIcon className="w-6 h-6" /> : <Bars3Icon className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {isMobileMenuOpen && (
          <div
            className="md:hidden mt-3 pt-4 pb-5 px-3 border-t space-y-4"
            style={{ borderColor: "var(--jj-border)" }}
          >
            <div className="grid grid-cols-2 gap-2">
              {PRODUCT_ROLES.map((item) => (
                <button
                  key={item.role}
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    openDemo(item.role);
                  }}
                  className="text-left text-xs px-3 py-2 rounded-lg border"
                  style={{
                    backgroundColor: "var(--jj-surface)",
                    borderColor: "var(--jj-border)",
                    color: "var(--jj-text)",
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setIsMobileMenuOpen(false);
                openDemo();
              }}
              className="w-full py-3 bg-[#9eff00] text-black font-bold text-sm uppercase"
              style={{
                clipPath:
                  "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)",
              }}
            >
              GET A FREE DEMO
            </button>
          </div>
        )}
      </header>

      {currentView === "privacy" ? (
        <PrivacyPolicyView
          onBack={() => {
            setCurrentView("home");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onScheduleDemo={() => openDemo()}
        />
      ) : (
        <main className="pt-16">
          {/* 1. HERO SECTION — Custom Ready-to-Work Voice Agent in 2–3 Days + Transparent 3D Robot */}
          <section className="container mx-auto px-4 sm:px-8" aria-label="Hero">
            <div className="flex flex-col md:grid md:grid-cols-2 gap-8 items-center md:min-h-[calc(100vh-4rem)] py-10 md:py-12">
              <div className="text-left order-2 md:order-1">
                <p
                  className="font-semibold text-sm tracking-wide uppercase"
                  style={{ color: "var(--jj-accent)" }}
                >
                  #1 Enterprise Human-Like AI Voice Agents
                </p>

                <h1
                  className="text-4xl sm:text-5xl lg:text-[52px] font-extrabold mt-2.5 leading-[1.15]"
                  style={{ color: "var(--jj-text)" }}
                >
                  Deploy Your Custom Ready-to-Work AI Voice Agent in{" "}
                  <span className="relative inline-block whitespace-nowrap">
                    <span className="relative z-10" style={{ color: "var(--jj-logo)" }}>
                      2–3 Days
                    </span>
                    <svg
                      className="absolute -bottom-1 sm:-bottom-2 left-0 w-full h-auto"
                      style={{ color: "var(--jj-logo)" }}
                      viewBox="0 0 180 12"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      preserveAspectRatio="none"
                    >
                      <path
                        d="M3.5 9.8C32 5.2 132 1.2 176.5 9.8"
                        stroke="currentColor"
                        strokeWidth="5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </h1>

                <p
                  className="text-base sm:text-lg mt-5 max-w-xl leading-relaxed"
                  style={{ color: "var(--jj-muted)" }}
                >
                  Custom-engineered AI voice specialists deployed for your exact
                  business workflows — automating inbound support, outbound sales,
                  smart IVR routing, and instant appointment booking 24/7.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 mt-6 max-w-lg">
                  {[
                    "Ultra-Realistic Human Voice",
                    "Custom-Built in 2–3 Days",
                    "Fluent Multilingual Speech",
                    "Autonomous Call Workflows",
                    "Instant CRM & Calendar Sync",
                    "Zero Missed Calls — 24/7",
                  ].map((feat) => (
                    <div key={feat} className="flex items-center gap-2.5">
                      <div
                        className="p-1 rounded-md flex-shrink-0"
                        style={{ backgroundColor: "var(--jj-accent-soft)" }}
                      >
                        <CheckIcon
                          className="w-4 h-4"
                          style={{ color: "var(--jj-accent)" }}
                        />
                      </div>
                      <span className="text-sm sm:text-base font-medium" style={{ color: "var(--jj-text)" }}>
                        {feat}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-8">
                  <button
                    type="button"
                    onClick={() => openDemo()}
                    className="py-3.5 px-9 text-base sm:text-lg font-extrabold uppercase text-black bg-[#9eff00] hover:bg-[#bfff40] transition-all duration-300 hover:scale-105 shadow-[0_0_28px_rgba(158,255,0,0.35)] cursor-pointer"
                    style={{
                      clipPath:
                        "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)",
                    }}
                  >
                    BOOK A LIVE DEMO
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-x-8 sm:gap-x-10 gap-y-4 mt-8">
                  <div className="flex items-center gap-2.5">
                    <IsoCertificateIcon
                      className="w-6 h-6"
                      style={{ color: "var(--jj-logo)" }}
                    />
                    <span className="text-base font-medium" style={{ color: "var(--jj-text)" }}>
                      ISO 27001 Security
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <TargetIcon
                      className="w-6 h-6"
                      style={{ color: "var(--jj-logo)" }}
                    />
                    <span className="text-base font-medium" style={{ color: "var(--jj-text)" }}>
                      99.4% Call Accuracy
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <PackageIcon
                      className="w-6 h-6"
                      style={{ color: "var(--jj-logo)" }}
                    />
                    <span className="text-base font-medium" style={{ color: "var(--jj-text)" }}>
                      2–3 Day Go-Live
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Column: 3D Animated Robot — 100% Transparent Canvas (color-scheme: normal!) */}
              <div
                className={`relative h-[44vh] sm:h-[54vh] md:h-[580px] w-full flex items-center justify-center order-1 md:order-2 ${landingStyles.splineStage}`}
              >
                <div className={`relative w-full h-full ${landingStyles.splineStage}`}>
                  <div
                    className={`absolute -inset-6 rounded-full blur-3xl pointer-events-none ${landingStyles.heroGlow}`}
                    style={{ backgroundColor: "var(--jj-accent-soft)" }}
                  />
                  <div className={`relative w-full h-full z-10 ${landingStyles.splineStage}`}>
                    <iframe
                      src="https://my.spline.design/genkubgreetingrobot-7FQGM1zpHhOXPrzWz2zcIDUe/"
                      frameBorder="0"
                      width="100%"
                      height="100%"
                      title="Jill-Jill Interactive 3D Voice Agent"
                      loading="eager"
                      className={landingStyles.splineIframe}
                      style={{ colorScheme: "normal", background: "transparent" }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 2. MEASURABLE BUSINESS OUTCOMES */}
          <section
            className="py-16 sm:py-20 border-y"
            style={{
              backgroundColor: "var(--jj-secondary)",
              borderColor: "var(--jj-border)",
            }}
          >
            <div className="container mx-auto px-6">
              <AnimatedSection>
                <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
                  Measurable Impact From Week One
                </h2>
              </AnimatedSection>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                {[
                  {
                    icon: <CalendarDaysIcon />,
                    title: "3x More Booked Appointments",
                    description: "Instant qualification & live calendar scheduling.",
                  },
                  {
                    icon: <PhoneCallIcon />,
                    title: "Unlimited Concurrent Calls",
                    description: "Inbound reception + outbound outreach simultaneously.",
                  },
                  {
                    icon: <CreditCardIcon />,
                    title: "Up to 70% Lower Call Cost",
                    description: "Predictable ROI with zero hiring or training delays.",
                  },
                  {
                    icon: <PackageIcon />,
                    title: "Live in 2–3 Days",
                    description: "Fully customized around your exact business script.",
                  },
                ].map((item, idx) => (
                  <AnimatedSection delay={idx * 90} key={item.title}>
                    <div
                      className="group p-6 rounded-xl border text-center transition-all duration-300 hover:-translate-y-2 h-full"
                      style={{
                        backgroundColor: "var(--jj-primary)",
                        borderColor: "var(--jj-border)",
                      }}
                    >
                      <div
                        className="w-12 h-12 mx-auto mb-4 transition-transform duration-300 group-hover:scale-110"
                        style={{ color: "var(--jj-accent)" }}
                      >
                        {item.icon}
                      </div>
                      <h3 className="text-xl font-bold mb-2">{item.title}</h3>
                      <p style={{ color: "var(--jj-muted)" }}>{item.description}</p>
                    </div>
                  </AnimatedSection>
                ))}
              </div>
            </div>
          </section>

          {/* 3. WHY ENTERPRISES CHOOSE JILL-JILL */}
          <section className="py-16 sm:py-20">
            <div className="container mx-auto px-6">
              <AnimatedSection>
                <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
                  Built for Modern Client Acquisition &amp; Support
                </h2>
              </AnimatedSection>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {whyItWorksData.map((item, index) => (
                  <AnimatedSection delay={index * 80} key={item.title}>
                    <div
                      className="group p-6 rounded-xl border flex flex-col items-start transition-all duration-300 hover:-translate-y-2 h-full"
                      style={{
                        backgroundColor: "var(--jj-primary)",
                        borderColor: "var(--jj-border)",
                      }}
                    >
                      <div
                        className="w-10 h-10 mb-4 transition-transform duration-300 group-hover:scale-110"
                        style={{ color: "var(--jj-accent)" }}
                      >
                        {item.icon}
                      </div>
                      <h3 className="text-xl font-bold mb-2">{item.title}</h3>
                      <p style={{ color: "var(--jj-muted)" }}>{item.description}</p>
                    </div>
                  </AnimatedSection>
                ))}
              </div>
            </div>
          </section>

          {/* 4. THE CLEAR ADVANTAGE */}
          <section
            className="py-16 sm:py-20 border-y"
            style={{
              backgroundColor: "var(--jj-secondary)",
              borderColor: "var(--jj-border)",
            }}
          >
            <div className="container mx-auto px-6">
              <AnimatedSection>
                <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
                  The Jill-Jill Advantage
                </h2>
              </AnimatedSection>
              <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                <AnimatedSection delay={100}>
                  <div
                    className="p-7 rounded-xl border border-red-500/35 h-full shadow-lg"
                    style={{ backgroundColor: "var(--jj-primary)" }}
                  >
                    <h3 className="text-2xl font-bold mb-5 text-center">Traditional Call Teams</h3>
                    <ul className="space-y-3.5" style={{ color: "var(--jj-muted)" }}>
                      <li className="flex items-start gap-3">
                        <MinusCircleIcon className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
                        <span>Weeks of hiring, scripting, and inconsistent call quality</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <MinusCircleIcon className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
                        <span>Missed enquiries outside office hours &amp; busy lines</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <MinusCircleIcon className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
                        <span>Manual CRM updates and unrecorded follow-ups</span>
                      </li>
                    </ul>
                  </div>
                </AnimatedSection>

                <AnimatedSection delay={200}>
                  <div
                    className="p-7 rounded-xl border border-[#9eff00]/45 h-full shadow-lg"
                    style={{ backgroundColor: "var(--jj-primary)" }}
                  >
                    <h3 className="text-2xl font-bold mb-5 text-center">With Jill-Jill Voice AI</h3>
                    <ul className="space-y-3.5">
                      <li className="flex items-start gap-3">
                        <CheckBadgeIcon
                          className="w-6 h-6 flex-shrink-0 mt-0.5"
                          style={{ color: "var(--jj-accent)" }}
                        />
                        <span>Custom-deployed for your business in just 2–3 days</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <CheckBadgeIcon
                          className="w-6 h-6 flex-shrink-0 mt-0.5"
                          style={{ color: "var(--jj-accent)" }}
                        />
                        <span>Instant pickup 24/7 in English, Tamil, Tanglish &amp; Hindi</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <CheckBadgeIcon
                          className="w-6 h-6 flex-shrink-0 mt-0.5"
                          style={{ color: "var(--jj-accent)" }}
                        />
                        <span>Automatic transcripts, recordings &amp; verified bookings</span>
                      </li>
                    </ul>
                  </div>
                </AnimatedSection>
              </div>
            </div>
          </section>

          {/* 5. PROVEN RESULTS STATS */}
          <section className="py-16 sm:py-20">
            <div className="container mx-auto px-6">
              <AnimatedSection>
                <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
                  Proven Enterprise Results
                </h2>
              </AnimatedSection>
              <div className="flex flex-col md:flex-row justify-around text-center gap-10 md:gap-8">
                <StatItem value="3+" label="Days Average Custom Go-Live" />
                <StatItem value="100+" label="Qualified Appointments Weekly" />
                <StatItem value="24/7" label="Zero-Wait Autonomous Coverage" />
              </div>
            </div>
          </section>

          {/* 6. TESTIMONIALS */}
          <section
            className="py-16 sm:py-20 border-y"
            style={{
              backgroundColor: "var(--jj-secondary)",
              borderColor: "var(--jj-border)",
            }}
          >
            <div className="container mx-auto px-6">
              <AnimatedSection>
                <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
                  Trusted by Growth-Focused Teams
                </h2>
              </AnimatedSection>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                {testimonialsData.map((t, index) => (
                  <AnimatedSection delay={index * 100} key={t.name}>
                    <div
                      className="p-6 rounded-xl border text-center flex flex-col h-full transition-all duration-300 hover:-translate-y-2"
                      style={{
                        backgroundColor: "var(--jj-primary)",
                        borderColor: "var(--jj-border)",
                      }}
                    >
                      <p className="text-base sm:text-lg italic mb-4">
                        &ldquo;{t.quote}&rdquo;
                      </p>
                      <div
                        className="mt-auto pt-4 border-t"
                        style={{ borderColor: "var(--jj-border)" }}
                      >
                        <p className="font-bold" style={{ color: "var(--jj-accent)" }}>
                          {t.name}
                        </p>
                        <p className="text-sm" style={{ color: "var(--jj-muted)" }}>
                          {t.title}
                        </p>
                      </div>
                    </div>
                  </AnimatedSection>
                ))}
              </div>
            </div>
          </section>

          {/* 7. FAQ SECTION */}
          <section className="py-16 sm:py-20">
            <div className="container mx-auto px-6 max-w-3xl">
              <AnimatedSection>
                <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
                  Frequently Asked Questions
                </h2>
              </AnimatedSection>
              <div className="space-y-4">
                {faqData.map((faq) => (
                  <FaqAccordionItem
                    key={faq.question}
                    question={faq.question}
                    answer={faq.answer}
                  />
                ))}
              </div>
            </div>
          </section>

          {/* 8. FINAL CTA & CONTACT */}
          <section
            className="py-20 border-t text-center"
            style={{
              backgroundColor: "var(--jj-secondary)",
              borderColor: "var(--jj-border)",
            }}
          >
            <div className="container mx-auto px-6 max-w-4xl">
              <AnimatedSection>
                <h2 className="text-4xl sm:text-5xl font-extrabold mb-4">
                  Ready to Launch Your Custom AI Voice Agent in 2–3 Days?
                </h2>
                <p
                  className="my-6 text-lg max-w-2xl mx-auto"
                  style={{ color: "var(--jj-muted)" }}
                >
                  Test our live industry voice agents right in your browser now, or
                  connect with our team for a tailored deployment plan.
                </p>
                <button
                  type="button"
                  onClick={() => openDemo()}
                  className={`uppercase bg-[#9eff00] hover:bg-[#bfff40] text-black font-extrabold py-4 px-10 text-lg transition-all duration-300 hover:scale-105 cursor-pointer ${landingStyles.pulseGlowBtn}`}
                  style={{
                    clipPath:
                      "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)",
                  }}
                >
                  EXPERIENCE LIVE VOICE DEMO
                </button>

                <div className="mt-14 flex flex-col sm:flex-row justify-center items-center gap-10">
                  <div className="flex items-center gap-3">
                    <EnvelopeIcon
                      className="w-7 h-7"
                      style={{ color: "var(--jj-accent)" }}
                    />
                    <a
                      href="mailto:vims20.vs@gmail.com"
                      className="text-sm sm:text-base hover:underline"
                      style={{ color: "var(--jj-text)" }}
                    >
                      vims20.vs@gmail.com
                    </a>
                  </div>
                  <div className="flex items-center gap-3">
                    <MapPinIcon
                      className="w-7 h-7"
                      style={{ color: "var(--jj-accent)" }}
                    />
                    <span className="text-sm sm:text-base" style={{ color: "var(--jj-text)" }}>
                      Bangalore, India
                    </span>
                  </div>
                </div>
              </AnimatedSection>
            </div>
          </section>
        </main>
      )}

      {/* Footer */}
      <footer
        className="border-t py-7"
        style={{
          backgroundColor: "var(--jj-primary)",
          borderColor: "var(--jj-border)",
          color: "var(--jj-muted)",
        }}
      >
        <div className="container mx-auto text-center text-sm space-y-2">
          <div className="mb-2">
            <a
              href="https://www.linkedin.com/in/vims-enterprise-4898b1314"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Follow us on LinkedIn"
              className="inline-block transition-transform duration-300 hover:scale-110"
            >
              <LinkedInIcon className="w-6 h-6" />
            </a>
          </div>
          <p>&copy; {new Date().getFullYear()} Jill-Jill. All rights reserved.</p>
          <p>Jill-Jill Powered by VIMS Enterprise</p>
          <div className="pt-1 flex items-center justify-center gap-4">
            {currentView === "privacy" && (
              <button
                type="button"
                onClick={() => {
                  setCurrentView("home");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="underline cursor-pointer"
              >
                Back to Home
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setCurrentView("privacy");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="underline cursor-pointer"
            >
              Privacy Policy
            </button>
          </div>
        </div>
      </footer>

      <LeadAndDemoModal
        isOpen={isDemoModalOpen}
        onClose={() => setIsDemoModalOpen(false)}
        preselectedRole={preselectedRole}
      />

      <Chatbot />
    </div>
  );
}

const FaqAccordionItem: React.FC<{ question: string; answer: string }> = ({
  question,
  answer,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        backgroundColor: "var(--jj-primary)",
        borderColor: "var(--jj-border)",
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex justify-between items-center text-left py-4 px-5 text-base sm:text-lg font-semibold cursor-pointer"
      >
        <span>{question}</span>
        <span className="ml-4" style={{ color: "var(--jj-accent)" }}>
          {isOpen ? <MinusIcon className="w-5 h-5" /> : <PlusIcon className="w-5 h-5" />}
        </span>
      </button>
      {isOpen && (
        <div
          className="px-5 pb-4 pt-3 text-sm sm:text-base border-t leading-relaxed"
          style={{
            borderColor: "var(--jj-border)",
            color: "var(--jj-muted)",
          }}
        >
          {answer}
        </div>
      )}
    </div>
  );
};

const PrivacyPolicyView: React.FC<{
  onBack: () => void;
  onScheduleDemo: () => void;
}> = ({ onBack, onScheduleDemo }) => {
  return (
    <main className="pt-24 sm:pt-28 pb-20 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-semibold cursor-pointer"
          style={{ color: "var(--jj-muted)" }}
        >
          <ArrowLeftIcon className="w-4 h-4" />
          <span>Back to Home</span>
        </button>
      </div>

      <section
        className="border rounded-2xl p-6 sm:p-10 mb-8 shadow-xl"
        style={{
          backgroundColor: "var(--jj-secondary)",
          borderColor: "var(--jj-border)",
        }}
      >
        <div
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-6"
          style={{ borderColor: "var(--jj-border)" }}
        >
          <div>
            <span
              className="inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-3"
              style={{
                backgroundColor: "var(--jj-accent-soft)",
                color: "var(--jj-accent)",
              }}
            >
              Legal Documentation
            </span>
            <h1 className="text-3xl sm:text-4xl font-extrabold">Privacy Policy</h1>
          </div>
          <div className="text-xs" style={{ color: "var(--jj-muted)" }}>
            ISO 27001 Certified Standards
          </div>
        </div>

        <div className="mt-6 space-y-6 text-sm sm:text-base leading-relaxed" style={{ color: "var(--jj-muted)" }}>
          <p>
            Jill-Jill (&ldquo;us&rdquo;, &ldquo;we&rdquo;, or &ldquo;our&rdquo;), powered by VIMS Enterprise,
            operates the Jill-Jill AI Voice Agent platform. We collect contact details
            (name, phone number, email address, business information) solely to provide live AI
            voice demonstrations, schedule consultations, and deliver enterprise voice automation.
          </p>
          <p>
            All voice sessions, transcripts, and CRM integrations are protected with
            enterprise-grade encryption and ISO 27001 security controls. We never sell your
            personal information to third parties.
          </p>
          <p>
            For privacy inquiries, contact us at{" "}
            <a href="mailto:vims20.vs@gmail.com" className="underline" style={{ color: "var(--jj-accent)" }}>
              vims20.vs@gmail.com
            </a>{" "}
            (Bangalore, India).
          </p>
        </div>

        <div className="mt-8 flex flex-wrap gap-4 justify-between items-center pt-6 border-t" style={{ borderColor: "var(--jj-border)" }}>
          <button
            type="button"
            onClick={onBack}
            className="px-5 py-2.5 rounded-lg border text-sm font-semibold cursor-pointer"
            style={{ borderColor: "var(--jj-border)" }}
          >
            Return to Homepage
          </button>
          <button
            type="button"
            onClick={onScheduleDemo}
            className="py-3 px-8 bg-[#9eff00] text-black font-bold uppercase text-sm cursor-pointer"
            style={{
              clipPath:
                "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)",
            }}
          >
            Book a Live Demo
          </button>
        </div>
      </section>
    </main>
  );
};

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
    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.unobserve(element);
        }
      },
      { threshold: 0.08 }
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
      <p className="text-3xl sm:text-4xl md:text-5xl font-extrabold" style={{ color: "var(--jj-accent)" }}>
        {prefix}
        {count}
        {suffix}
      </p>
      <p className="text-sm sm:text-base md:text-lg mt-1.5" style={{ color: "var(--jj-muted)" }}>
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
  { label: "Hospital Assistant", role: "vasan" },
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
        "Warm, natural voice specialists that listen attentively, understand customer intent, qualify enquiries, and book confirmed appointments.",
    },
    {
      icon: <ClockIcon />,
      title: "Custom-Deployed in 2–3 Days",
      description:
        "We tailor the persona, domain context, and call journey around your brand so your custom voice specialist goes live within 2 to 3 days.",
    },
    {
      icon: <CrmIntegrationIcon />,
      title: "Effortless Business Workflow Sync",
      description:
        "Appointment schedules, qualified leads, and call summaries flow smoothly into your team's daily workflow without manual effort.",
    },
    {
      icon: <LanguageIcon />,
      title: "Fluent Native Multilingual Speech",
      description:
        "Converses naturally across English, Tamil, Tanglish, Hindi, and regional Indian languages with authentic local warmth.",
    },
    {
      icon: <ChartBarIcon />,
      title: "Clear Executive Call Insights",
      description:
        "Receive concise conversation highlights, customer intent signals, and outcome summaries so your team focuses on closing.",
    },
    {
      icon: <CpuChipIcon />,
      title: "Instant, Natural Turn-Taking",
      description:
        "Adaptive conversational intelligence responds smoothly in real time without robotic delays — callers feel genuinely heard.",
    },
  ];

  const testimonialsData = [
    {
      quote:
        "Jill-Jill launched our custom voice specialist in under 72 hours. We are booking qualified appointments around the clock while our team focuses purely on closing.",
      name: "VP of Sales",
      title: "Enterprise Growth Leader",
    },
    {
      quote:
        "Patients love how warm and natural the assistant sounds in both Tamil and English. We eliminated missed after-hours enquiries from day one.",
      name: "Operations Director",
      title: "Multi-Specialty Healthcare Group",
    },
    {
      quote:
        "We saw a 42% jump in qualified opportunities within the first month. Automated summaries and instant scheduling save our team hours every single day.",
      name: "Founder & CEO",
      title: "Performance Marketing Agency",
    },
    {
      quote:
        "The onboarding was effortless and the live voice quality impressed our entire leadership team. It scales smoothly during peak hours without wait times.",
      name: "Chief Operating Officer",
      title: "Financial Services Group",
    },
  ];

  const faqData = [
    {
      question: "How quickly can you customize and launch our AI Voice Agent?",
      answer:
        "Within just 2 to 3 days. Our team tailors the conversation flow, domain knowledge, multilingual greetings, and scheduling preferences around your business so you go live immediately.",
    },
    {
      question: "Can callers speak naturally in Indian languages or switch mid-call?",
      answer:
        "Yes. Our voice specialists converse naturally in English, Tamil, Tanglish, Hindi, and more — automatically following the caller's language with live captions.",
    },
    {
      question: "Do we need any technical team to manage it?",
      answer:
        "None at all. Everything is delivered as a turnkey managed solution with an intuitive dashboard to review call outcomes, recordings, summaries, and leads.",
    },
    {
      question: "How does it fit into our existing appointment or sales process?",
      answer:
        "Captured enquiries, appointment requests, and concise call insights sync directly into your team's daily calendar and business workflow.",
    },
  ];

  return (
    <div
      className={`${landingStyles.landingRoot} font-sans`}
      data-jj-theme={theme}
    >
      {/* ── Fixed Responsive Header (320px iPhone SE -> 2560px Desktop) ──────── */}
      <header
        className="py-2.5 px-3.5 sm:px-8 md:px-12 fixed top-0 left-0 right-0 backdrop-blur-md z-40 border-b"
        style={{
          backgroundColor: "var(--jj-header)",
          borderColor: "var(--jj-border)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <div className="container mx-auto flex justify-between items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setCurrentView("home");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="flex items-center gap-1.5 sm:gap-2 min-h-[38px] transition-transform duration-300 hover:-translate-y-px cursor-pointer touch-manipulation flex-shrink-0"
            aria-label="Jill-Jill Home"
          >
            <BellIcon
              className={`w-5 h-5 sm:w-6 sm:h-6 ${landingStyles.bellRing}`}
              style={{ color: "var(--jj-logo)" }}
            />
            <span
              className="text-base sm:text-xl font-bold tracking-wider"
              style={{ color: "var(--jj-logo)" }}
            >
              Jill-Jill
            </span>
          </button>

          {/* Desktop & Large Tablet Nav */}
          <div className="hidden lg:flex items-center gap-5">
            <div ref={productDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setIsProductDropdownOpen(!isProductDropdownOpen)}
                className="flex items-center gap-1 min-h-[38px] px-2 text-sm font-medium transition-colors cursor-pointer touch-manipulation"
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
                    WebkitBackdropFilter: "blur(16px)",
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
                          className="w-full text-left px-3.5 py-2.5 rounded-lg hover:bg-teal-400/15 transition-colors cursor-pointer touch-manipulation"
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
              className="flex items-center gap-1.5 min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-bold tracking-wider uppercase border transition-all duration-200 hover:-translate-y-px touch-manipulation"
              style={{
                backgroundColor: "var(--jj-surface)",
                borderColor: "var(--jj-border)",
                color: "var(--jj-text)",
              }}
              title="Open Admin Dashboard"
            >
              <LayoutDashboardIcon className="w-4 h-4 text-teal-400" />
              <span>DASHBOARD</span>
            </Link>

            <button
              type="button"
              onClick={toggleTheme}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-full transition-colors cursor-pointer touch-manipulation"
              style={{ color: "var(--jj-muted)" }}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
            </button>

            <button
              type="button"
              onClick={() => openDemo()}
              className="min-h-[40px] py-2 px-5 text-xs sm:text-sm font-bold uppercase text-teal-950 bg-teal-400 hover:bg-teal-300 rounded-xl shadow-[0_6px_18px_rgba(20,184,166,0.25)] transition-all duration-200 hover:-translate-y-0.5 cursor-pointer touch-manipulation"
            >
              BOOK A LIVE DEMO
            </button>
          </div>

          {/* Mobile & Tablet Compact Touch Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2 lg:hidden">
            <button
              type="button"
              onClick={() => openDemo()}
              className="min-h-[38px] px-3 sm:px-3.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-extrabold uppercase bg-teal-400 hover:bg-teal-300 active:scale-95 text-teal-950 transition-transform cursor-pointer touch-manipulation"
            >
              LIVE DEMO
            </button>
            <Link
              href="/overview"
              className="min-h-[38px] min-w-[38px] flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border touch-manipulation"
              style={{
                backgroundColor: "var(--jj-surface)",
                borderColor: "var(--jj-border)",
                color: "var(--jj-accent)",
              }}
              aria-label="Admin Dashboard"
            >
              <LayoutDashboardIcon className="w-4 h-4" />
              <span className="hidden sm:inline">DASHBOARD</span>
            </Link>
            <button
              type="button"
              onClick={toggleTheme}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-full touch-manipulation"
              style={{ color: "var(--jj-muted)" }}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <SunIcon className="w-5 h-5" /> : <MoonIcon className="w-5 h-5" />}
            </button>
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg touch-manipulation"
              style={{ color: "var(--jj-text)" }}
              aria-label="Toggle menu"
            >
              {isMobileMenuOpen ? <XMarkIcon className="w-6 h-6" /> : <Bars3Icon className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {isMobileMenuOpen && (
          <div
            className="lg:hidden mt-3 pt-3.5 pb-4 px-1 border-t space-y-3 max-h-[75dvh] overflow-y-auto"
            style={{ borderColor: "var(--jj-border)", WebkitOverflowScrolling: "touch" }}
          >
            <Link
              href="/overview"
              onClick={() => setIsMobileMenuOpen(false)}
              className="min-h-[44px] flex items-center justify-center gap-2 py-2.5 rounded-xl border text-xs font-bold uppercase touch-manipulation"
              style={{
                backgroundColor: "var(--jj-surface)",
                borderColor: "var(--jj-border)",
                color: "var(--jj-text)",
              }}
            >
              <LayoutDashboardIcon className="w-4 h-4 text-teal-400" />
              <span>Open Admin Dashboard</span>
            </Link>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PRODUCT_ROLES.map((item) => (
                <button
                  key={item.role}
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    openDemo(item.role);
                  }}
                  className="min-h-[42px] text-left text-xs font-medium px-3 py-2 rounded-xl border truncate active:scale-95 transition-transform touch-manipulation"
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
        <main className="pt-16 sm:pt-20">
          {/* 1. HERO SECTION */}
          <section className="container mx-auto px-4 sm:px-8" aria-label="Hero">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center lg:min-h-[calc(100vh-5rem)] py-5 sm:py-9 lg:py-12">
              <div className="lg:col-span-7 text-left order-1">
                <h1
                  className="text-[28px] sm:text-4xl md:text-5xl lg:text-[52px] font-extrabold tracking-tight leading-[1.14]"
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
                  className="text-sm sm:text-base lg:text-lg mt-4 max-w-xl leading-relaxed"
                  style={{ color: "var(--jj-muted)" }}
                >
                  Custom-crafted AI voice specialists tailored around your exact
                  business workflows — handling inbound enquiries, outbound outreach,
                  smart call routing, and appointment scheduling 24/7.
                </p>

                <div className="grid grid-cols-1 min-[370px]:grid-cols-2 gap-x-4 sm:gap-x-6 gap-y-2.5 sm:gap-y-3 mt-5 sm:mt-6 max-w-lg">
                  {[
                    "Ultra-Natural Human Voice",
                    "Custom-Built in 2–3 Days",
                    "Fluent Regional Languages",
                    "Autonomous Call Handling",
                    "Seamless Calendar Sync",
                    "Zero Missed Calls — 24/7",
                  ].map((feat) => (
                    <div key={feat} className="flex items-center gap-2">
                      <div
                        className="p-1 rounded-md flex-shrink-0"
                        style={{ backgroundColor: "var(--jj-accent-soft)" }}
                      >
                        <CheckIcon
                          className="w-3.5 h-3.5 sm:w-4 sm:h-4"
                          style={{ color: "var(--jj-accent)" }}
                        />
                      </div>
                      <span className="text-xs sm:text-sm md:text-base font-medium" style={{ color: "var(--jj-text)" }}>
                        {feat}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-6 sm:mt-8">
                  <button
                    type="button"
                    onClick={() => openDemo()}
                    className="w-full sm:w-auto min-h-[48px] py-3.5 px-9 rounded-xl text-sm sm:text-base md:text-lg font-extrabold uppercase text-teal-950 bg-teal-400 hover:bg-teal-300 active:scale-[0.99] transition-all duration-200 sm:hover:-translate-y-0.5 shadow-[0_10px_28px_rgba(20,184,166,0.30)] cursor-pointer touch-manipulation"
                  >
                    BOOK A LIVE DEMO
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-x-5 sm:gap-x-10 gap-y-2.5 mt-6 sm:mt-8">
                  <div className="flex items-center gap-2">
                    <IsoCertificateIcon
                      className="w-5 h-5 sm:w-6 sm:h-6"
                      style={{ color: "var(--jj-logo)" }}
                    />
                    <span className="text-xs sm:text-base font-medium" style={{ color: "var(--jj-text)" }}>
                      Enterprise Privacy
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <TargetIcon
                      className="w-5 h-5 sm:w-6 sm:h-6"
                      style={{ color: "var(--jj-logo)" }}
                    />
                    <span className="text-xs sm:text-base font-medium" style={{ color: "var(--jj-text)" }}>
                      High Call Accuracy
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <PackageIcon
                      className="w-5 h-5 sm:w-6 sm:h-6"
                      style={{ color: "var(--jj-logo)" }}
                    />
                    <span className="text-xs sm:text-base font-medium" style={{ color: "var(--jj-text)" }}>
                      2–3 Day Go-Live
                    </span>
                  </div>
                </div>
              </div>

              {/* 3D Animated Robot — Touch-Scroll Safe on iPhone/iPad/Android, Interactive on Desktop */}
              <div
                className={`lg:col-span-5 relative h-[250px] sm:h-[340px] lg:h-[540px] w-full flex items-center justify-center order-2 pointer-events-none lg:pointer-events-auto ${landingStyles.splineStage}`}
              >
                <div className={`relative w-full h-full ${landingStyles.splineStage}`}>
                  <div
                    className={`absolute -inset-4 rounded-full blur-3xl pointer-events-none ${landingStyles.heroGlow}`}
                    style={{ backgroundColor: "var(--jj-accent-soft)" }}
                  />
                  <div className={`relative w-full h-full z-10 ${landingStyles.splineStage}`}>
                    <iframe
                      src="https://my.spline.design/genkubgreetingrobot-7FQGM1zpHhOXPrzWz2zcIDUe/"
                      frameBorder="0"
                      width="100%"
                      height="100%"
                      title="Jill-Jill Interactive 3D Voice Agent"
                      loading="lazy"
                      className={landingStyles.splineIframe}
                      style={{ colorScheme: "normal", background: "transparent" }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 2. BUSINESS OUTCOMES */}
          <section
            className="py-14 sm:py-20 border-y"
            style={{
              backgroundColor: "var(--jj-secondary)",
              borderColor: "var(--jj-border)",
            }}
          >
            <div className="container mx-auto px-4 sm:px-6">
              <AnimatedSection>
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center mb-10 sm:mb-12">
                  Measurable Impact From Week One
                </h2>
              </AnimatedSection>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-7">
                {[
                  {
                    icon: <CalendarDaysIcon />,
                    title: "3x More Booked Appointments",
                    description: "Instant qualification & automated scheduling.",
                  },
                  {
                    icon: <PhoneCallIcon />,
                    title: "Zero Hold Times",
                    description: "Answers every customer call simultaneously.",
                  },
                  {
                    icon: <CreditCardIcon />,
                    title: "Up to 70% Cost Savings",
                    description: "Predictable growth without staffing bottlenecks.",
                  },
                  {
                    icon: <PackageIcon />,
                    title: "Live in 2–3 Days",
                    description: "Tailored end-to-end for your business.",
                  },
                ].map((item, idx) => (
                  <AnimatedSection delay={idx * 80} key={item.title}>
                    <div
                      className="group p-5 sm:p-6 rounded-xl border text-center transition-all duration-300 hover:-translate-y-1.5 h-full"
                      style={{
                        backgroundColor: "var(--jj-primary)",
                        borderColor: "var(--jj-border)",
                      }}
                    >
                      <div
                        className="w-11 h-11 mx-auto mb-3.5 transition-transform duration-300 group-hover:scale-110"
                        style={{ color: "var(--jj-accent)" }}
                      >
                        {item.icon}
                      </div>
                      <h3 className="text-lg sm:text-xl font-bold mb-1.5">{item.title}</h3>
                      <p className="text-sm" style={{ color: "var(--jj-muted)" }}>{item.description}</p>
                    </div>
                  </AnimatedSection>
                ))}
              </div>
            </div>
          </section>

          {/* 3. CAPABILITIES */}
          <section className="py-14 sm:py-20">
            <div className="container mx-auto px-4 sm:px-6">
              <AnimatedSection>
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center mb-10 sm:mb-12">
                  Built for Modern Client Acquisition &amp; Care
                </h2>
              </AnimatedSection>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-7">
                {whyItWorksData.map((item, index) => (
                  <AnimatedSection delay={index * 70} key={item.title}>
                    <div
                      className="group p-5 sm:p-6 rounded-xl border flex flex-col items-start transition-all duration-300 hover:-translate-y-1.5 h-full"
                      style={{
                        backgroundColor: "var(--jj-primary)",
                        borderColor: "var(--jj-border)",
                      }}
                    >
                      <div
                        className="w-9 h-9 mb-3.5 transition-transform duration-300 group-hover:scale-110"
                        style={{ color: "var(--jj-accent)" }}
                      >
                        {item.icon}
                      </div>
                      <h3 className="text-lg sm:text-xl font-bold mb-1.5">{item.title}</h3>
                      <p className="text-sm sm:text-base leading-relaxed" style={{ color: "var(--jj-muted)" }}>
                        {item.description}
                      </p>
                    </div>
                  </AnimatedSection>
                ))}
              </div>
            </div>
          </section>

          {/* 4. COMPARISON */}
          <section
            className="py-14 sm:py-20 border-y"
            style={{
              backgroundColor: "var(--jj-secondary)",
              borderColor: "var(--jj-border)",
            }}
          >
            <div className="container mx-auto px-4 sm:px-6">
              <AnimatedSection>
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center mb-10 sm:mb-12">
                  The Jill-Jill Advantage
                </h2>
              </AnimatedSection>
              <div className="grid md:grid-cols-2 gap-6 sm:gap-8 max-w-5xl mx-auto">
                <AnimatedSection delay={80}>
                  <div
                    className="p-6 sm:p-7 rounded-xl border border-red-500/30 h-full"
                    style={{ backgroundColor: "var(--jj-primary)" }}
                  >
                    <h3 className="text-xl sm:text-2xl font-bold mb-4 text-center">Traditional Call Handling</h3>
                    <ul className="space-y-3 text-sm sm:text-base" style={{ color: "var(--jj-muted)" }}>
                      <li className="flex items-start gap-3">
                        <MinusCircleIcon className="w-5 h-5 sm:w-6 sm:h-6 text-red-400 flex-shrink-0 mt-0.5" />
                        <span>Weeks of hiring, training, and variable call quality</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <MinusCircleIcon className="w-5 h-5 sm:w-6 sm:h-6 text-red-400 flex-shrink-0 mt-0.5" />
                        <span>Missed enquiries after business hours &amp; peak rushes</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <MinusCircleIcon className="w-5 h-5 sm:w-6 sm:h-6 text-red-400 flex-shrink-0 mt-0.5" />
                        <span>Delayed follow-ups and manual note-taking</span>
                      </li>
                    </ul>
                  </div>
                </AnimatedSection>

                <AnimatedSection delay={160}>
                  <div
                    className="p-6 sm:p-7 rounded-xl border border-teal-400/35 h-full"
                    style={{ backgroundColor: "var(--jj-primary)" }}
                  >
                    <h3 className="text-xl sm:text-2xl font-bold mb-4 text-center">With Jill-Jill Voice AI</h3>
                    <ul className="space-y-3 text-sm sm:text-base">
                      <li className="flex items-start gap-3">
                        <CheckBadgeIcon
                          className="w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0 mt-0.5"
                          style={{ color: "var(--jj-accent)" }}
                        />
                        <span>Custom-deployed for your business in 2–3 days</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <CheckBadgeIcon
                          className="w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0 mt-0.5"
                          style={{ color: "var(--jj-accent)" }}
                        />
                        <span>Instant pickup 24/7 in English, Tamil, Tanglish &amp; Hindi</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <CheckBadgeIcon
                          className="w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0 mt-0.5"
                          style={{ color: "var(--jj-accent)" }}
                        />
                        <span>Actionable call summaries &amp; automatic appointment capture</span>
                      </li>
                    </ul>
                  </div>
                </AnimatedSection>
              </div>
            </div>
          </section>

          {/* 5. STATS */}
          <section className="py-14 sm:py-20">
            <div className="container mx-auto px-4 sm:px-6">
              <AnimatedSection>
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center mb-10 sm:mb-12">
                  Proven Business Outcomes
                </h2>
              </AnimatedSection>
              <div className="grid grid-cols-3 text-center gap-4 sm:gap-8 max-w-4xl mx-auto">
                <StatItem value="3+" label="Days Custom Go-Live" />
                <StatItem value="100+" label="Weekly Bookings" />
                <StatItem value="24/7" label="Always-On Coverage" />
              </div>
            </div>
          </section>

          {/* 6. TESTIMONIALS */}
          <section
            className="py-14 sm:py-20 border-y"
            style={{
              backgroundColor: "var(--jj-secondary)",
              borderColor: "var(--jj-border)",
            }}
          >
            <div className="container mx-auto px-4 sm:px-6">
              <AnimatedSection>
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center mb-10 sm:mb-12">
                  Trusted by Growth-Focused Businesses
                </h2>
              </AnimatedSection>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 max-w-5xl mx-auto">
                {testimonialsData.map((t, index) => (
                  <AnimatedSection delay={index * 80} key={t.name}>
                    <div
                      className="p-5 sm:p-6 rounded-xl border text-center flex flex-col h-full"
                      style={{
                        backgroundColor: "var(--jj-primary)",
                        borderColor: "var(--jj-border)",
                      }}
                    >
                      <p className="text-sm sm:text-lg italic mb-4">
                        &ldquo;{t.quote}&rdquo;
                      </p>
                      <div
                        className="mt-auto pt-3.5 border-t"
                        style={{ borderColor: "var(--jj-border)" }}
                      >
                        <p className="font-bold text-sm sm:text-base" style={{ color: "var(--jj-accent)" }}>
                          {t.name}
                        </p>
                        <p className="text-xs sm:text-sm" style={{ color: "var(--jj-muted)" }}>
                          {t.title}
                        </p>
                      </div>
                    </div>
                  </AnimatedSection>
                ))}
              </div>
            </div>
          </section>

          {/* 7. FAQ */}
          <section className="py-14 sm:py-20">
            <div className="container mx-auto px-4 sm:px-6 max-w-3xl">
              <AnimatedSection>
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center mb-10">
                  Frequently Asked Questions
                </h2>
              </AnimatedSection>
              <div className="space-y-3.5">
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
            className="py-16 sm:py-20 border-t text-center"
            style={{
              backgroundColor: "var(--jj-secondary)",
              borderColor: "var(--jj-border)",
            }}
          >
            <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
              <AnimatedSection>
                <h2 className="text-2xl sm:text-4xl md:text-5xl font-extrabold mb-4">
                  Ready to Launch Your Custom Voice Agent in 2–3 Days?
                </h2>
                <p
                  className="my-5 text-sm sm:text-lg max-w-2xl mx-auto"
                  style={{ color: "var(--jj-muted)" }}
                >
                  Speak live with our industry voice specialists right now, or reach out
                  for a tailored walkthrough for your business.
                </p>
                <button
                  type="button"
                  onClick={() => openDemo()}
                  className="w-full sm:w-auto uppercase bg-teal-400 hover:bg-teal-300 text-teal-950 font-extrabold py-3.5 sm:py-4 px-8 sm:px-10 rounded-xl text-base sm:text-lg shadow-[0_10px_28px_rgba(20,184,166,0.30)] transition-all duration-200 hover:-translate-y-0.5 cursor-pointer touch-manipulation"
                >
                  EXPERIENCE LIVE VOICE DEMO
                </button>

                <div className="mt-12 flex flex-col sm:flex-row justify-center items-center gap-6 sm:gap-10">
                  <div className="flex items-center gap-3">
                    <EnvelopeIcon
                      className="w-6 h-6"
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
                      className="w-6 h-6"
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
        className="border-t py-6 px-4"
        style={{
          backgroundColor: "var(--jj-primary)",
          borderColor: "var(--jj-border)",
          color: "var(--jj-muted)",
        }}
      >
        <div className="container mx-auto text-center text-xs sm:text-sm space-y-2">
          <div className="mb-2">
            <a
              href="https://www.linkedin.com/in/vims-enterprise-4898b1314"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Follow us on LinkedIn"
              className="inline-block transition-transform duration-300 hover:scale-110"
            >
              <LinkedInIcon className="w-5 h-5 sm:w-6 sm:h-6" />
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

      {!isDemoModalOpen && <Chatbot />}
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
        className="w-full flex justify-between items-center text-left py-3.5 sm:py-4 px-4 sm:px-5 text-sm sm:text-lg font-semibold cursor-pointer"
      >
        <span>{question}</span>
        <span className="ml-4 flex-shrink-0" style={{ color: "var(--jj-accent)" }}>
          {isOpen ? <MinusIcon className="w-5 h-5" /> : <PlusIcon className="w-5 h-5" />}
        </span>
      </button>
      {isOpen && (
        <div
          className="px-4 sm:px-5 pb-4 pt-3 text-xs sm:text-base border-t leading-relaxed"
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
    <main className="pt-20 sm:pt-28 pb-16 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
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
        className="border rounded-2xl p-5 sm:p-10 mb-8 shadow-xl"
        style={{
          backgroundColor: "var(--jj-secondary)",
          borderColor: "var(--jj-border)",
        }}
      >
        <div
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-5"
          style={{ borderColor: "var(--jj-border)" }}
        >
          <div>
            <span
              className="inline-block px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-2.5"
              style={{
                backgroundColor: "var(--jj-accent-soft)",
                color: "var(--jj-accent)",
              }}
            >
              Privacy &amp; Trust
            </span>
            <h1 className="text-2xl sm:text-4xl font-extrabold">Privacy Policy</h1>
          </div>
          <div className="text-xs" style={{ color: "var(--jj-muted)" }}>
            Enterprise Data Protection
          </div>
        </div>

        <div className="mt-5 space-y-5 text-sm sm:text-base leading-relaxed" style={{ color: "var(--jj-muted)" }}>
          <p>
            Jill-Jill, powered by VIMS Enterprise, operates the Jill-Jill AI Voice Agent
            service. Contact details provided during demonstrations are used solely to
            deliver live voice experiences, schedule consultations, and support your
            business enquiries.
          </p>
          <p>
            All conversations and business records are protected with enterprise-grade
            encryption and strict confidentiality standards. We never sell personal
            information to third parties.
          </p>
          <p>
            For enquiries, reach us at{" "}
            <a href="mailto:vims20.vs@gmail.com" className="underline" style={{ color: "var(--jj-accent)" }}>
              vims20.vs@gmail.com
            </a>{" "}
            (Bangalore, India).
          </p>
        </div>

        <div className="mt-7 flex flex-col sm:flex-row gap-3 justify-between items-center pt-5 border-t" style={{ borderColor: "var(--jj-border)" }}>
          <button
            type="button"
            onClick={onBack}
            className="w-full sm:w-auto px-5 py-2.5 rounded-lg border text-sm font-semibold cursor-pointer"
            style={{ borderColor: "var(--jj-border)" }}
          >
            Return to Homepage
          </button>
          <button
            type="button"
            onClick={onScheduleDemo}
            className="w-full sm:w-auto py-3 px-8 rounded-xl bg-teal-400 hover:bg-teal-300 text-teal-950 font-bold uppercase text-sm cursor-pointer touch-manipulation"
          >
            Book a Live Demo
          </button>
        </div>
      </section>
    </main>
  );
};

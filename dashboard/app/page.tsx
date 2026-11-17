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
  { label: "Vasan Eye Care Assistant", role: "vasan" },
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
      title: "Real Conversations, Real Results",
      description:
        "Natural-sounding AI agents that talk, qualify, and schedule meetings directly in your calendar.",
    },
    {
      icon: <ClockIcon />,
      title: "24/7 Lead Handling",
      description:
        "Never miss a lead again. Our AI agents work around the clock, even when your team is offline.",
    },
    {
      icon: <CrmIntegrationIcon />,
      title: "Plug & Play with Your CRM",
      description:
        "Seamless integration with HubSpot, Zoho, Pipedrive, and more for an automated workflow.",
    },
    {
      icon: <LanguageIcon />,
      title: "Multi-Language Support",
      description:
        "Engage clients in their native language with fluent support for English, Tamil, Tanglish, Hindi, and more.",
    },
    {
      icon: <ChartBarIcon />,
      title: "Data-Driven Insights",
      description:
        "Every call is analyzed and every minute is optimized to continuously improve performance.",
    },
    {
      icon: <CpuChipIcon />,
      title: "Advanced Conversational AI",
      description:
        "Powered by Gemini 3.1 Flash Live to handle complex interactions and deliver human-like conversations.",
    },
  ];

  const testimonialsData = [
    {
      quote:
        "The AI agents have completely transformed our outreach. We're booking qualified meetings on autopilot, allowing our sales team to focus purely on closing deals. Our pipeline has never been healthier.",
      name: "VP of Sales",
      title: "SaaS Unicorn",
    },
    {
      quote:
        "Onboarding was seamless, and we were live in 48 hours. The 24/7 lead qualification means we never miss an opportunity. It’s the most efficient growth engine we've ever implemented.",
      name: "Marketing Director",
      title: "FinTech Innovator",
    },
    {
      quote:
        "We've seen a 40% increase in qualified leads since partnering with Jill-Jill. The AI's conversational ability is remarkable, and the CRM integration saves us countless hours of manual work.",
      name: "Founder & CEO",
      title: "B2B Marketing Agency",
    },
    {
      quote:
        "The ROI was immediate. This isn't just a tool; it's a scalable salesforce that has become a core part of our growth strategy. The performance-based model sealed the deal for us.",
      name: "Chief Operating Officer",
      title: "Enterprise Solutions",
    },
  ];

  const faqData = [
    {
      question: "What are AI Voice Agents?",
      answer:
        "AI Voice Agents are advanced conversational AI designed to handle real-time voice interactions. They automate tasks like cold calling, inbound customer support, IVR routing, lead qualification, and appointment booking, acting as a 24/7 growth engine for your business.",
    },
    {
      question: "Do I need technical skills to set it up?",
      answer:
        "No. Our platform is designed as a 'done-for-you' service. We manage setup, custom prompts, integration, and telephony configuration, providing a true plug-and-play solution for immediate results.",
    },
    {
      question: "What CRMs does it integrate with?",
      answer:
        "Our system offers seamless integration with major CRMs and calendars including HubSpot, Zoho, Pipedrive, Cal.com, and custom webhooks so all conversations and scheduled meetings log automatically.",
    },
    {
      question: "How does the performance-based model work?",
      answer:
        "We believe in partnership. There are no high upfront fees. Our success is tied directly to the results we deliver, ensuring pure, predictable growth for your business.",
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
          {/* Left: Bell + Yellow Jill-Jill */}
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
              style={{ color: "var(--jj-logo)" } as React.CSSProperties}
            />
            <span
              className="text-lg sm:text-xl font-bold tracking-wider"
              style={{ color: "var(--jj-logo)" }}
            >
              Jill-Jill
            </span>
          </button>

          {/* Right: Desktop Navigation */}
          <div className="hidden md:flex items-center gap-5">
            {/* PRODUCTS Dropdown */}
            <div ref={productDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setIsProductDropdownOpen(!isProductDropdownOpen)}
                className="flex items-center gap-1 text-sm font-medium transition-colors cursor-pointer"
                style={{ color: "var(--jj-muted)" }}
                aria-haspopup="true"
                aria-expanded={isProductDropdownOpen}
              >
                <span className="hover:opacity-100">PRODUCTS</span>
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

            {/* DASHBOARD Button -> Admin Login / Overview */}
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

            {/* Theme Toggle */}
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

            {/* AUTOMATE YOUR SALES.. Angled Button */}
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

          {/* Mobile Controls */}
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

        {/* Mobile Drawer */}
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

      {/* ── Main Content or Full Privacy Policy View ─────────────────────────── */}
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
          {/* 1. HERO SECTION (Exact Match to Screenshot 1) */}
          <section className="container mx-auto px-4 sm:px-8" aria-label="Hero">
            <div className="flex flex-col md:grid md:grid-cols-2 gap-8 items-center md:min-h-[calc(100vh-4rem)] py-10 md:py-12">
              {/* Left Column */}
              <div className="text-left order-2 md:order-1">
                <p
                  className="font-semibold text-sm tracking-wide"
                  style={{ color: "var(--jj-accent)" }}
                >
                  #1 Rated Human-like AI Voice Agents
                </p>

                <h1
                  className="text-4xl sm:text-5xl lg:text-[54px] font-bold mt-2 leading-[1.15]"
                  style={{ color: "var(--jj-text)" }}
                >
                  Build Your Ready-to-Work AI{" "}
                  <br className="hidden sm:block" />
                  Voice Agent in Just{" "}
                  <span className="relative inline-block">
                    <span className="relative z-10" style={{ color: "var(--jj-logo)" }}>
                      1 Week
                    </span>
                    <svg
                      className="absolute -bottom-1 sm:-bottom-2 left-0 w-full h-auto"
                      style={{ color: "var(--jj-logo)" }}
                      viewBox="0 0 150 12"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      preserveAspectRatio="none"
                    >
                      <path
                        d="M3.38916 9.81171C25.1381 5.52523 108.591 1.01179 147.113 9.81171"
                        stroke="currentColor"
                        strokeWidth="5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </h1>

                <p
                  className="text-base mt-4 max-w-xl leading-relaxed"
                  style={{ color: "var(--jj-muted)" }}
                >
                  Create intelligent, human-like AI voice agents for B2B sales,
                  customer support, appointment booking and lead qualification.
                  Built to outperform human agents.
                </p>

                {/* 6 Feature Checkmarks */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 mt-6 max-w-lg">
                  {[
                    "Real-time Human Like Voice",
                    "Unlock 5x Productivity",
                    "Powered by Gemini 3.1 Flash",
                    "Automated Call Workflow",
                    "Enterprise-grade Security",
                    "Zero Missed Calls",
                  ].map((feat) => (
                    <div key={feat} className="flex items-center gap-2.5">
                      <div
                        className="p-1 rounded-md flex-shrink-0"
                        style={{ backgroundColor: "var(--jj-accent-soft)" }}
                      >
                        <CheckIcon
                          className="w-4 h-4"
                          style={{ color: "var(--jj-accent)" } as React.CSSProperties}
                        />
                      </div>
                      <span className="text-sm sm:text-base" style={{ color: "var(--jj-text)" }}>
                        {feat}
                      </span>
                    </div>
                  ))}
                </div>

                {/* GET A FREE DEMO CTA */}
                <div className="mt-8">
                  <button
                    type="button"
                    onClick={() => openDemo()}
                    className="py-3.5 px-8 text-base sm:text-lg font-bold uppercase text-black bg-[#9eff00] hover:bg-[#bfff40] transition-all duration-300 hover:scale-105 shadow-[0_0_28px_rgba(158,255,0,0.3)] cursor-pointer"
                    style={{
                      clipPath:
                        "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)",
                    }}
                  >
                    GET A FREE DEMO
                  </button>
                </div>

                {/* Trust • Accuracy • Delivery */}
                <div className="flex flex-wrap items-center gap-x-8 sm:gap-x-10 gap-y-4 mt-8">
                  <div className="flex items-center gap-2.5">
                    <IsoCertificateIcon
                      className="w-6 h-6"
                      style={{ color: "var(--jj-logo)" } as React.CSSProperties}
                    />
                    <span className="text-base font-medium" style={{ color: "var(--jj-text)" }}>
                      Trust
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <TargetIcon
                      className="w-6 h-6"
                      style={{ color: "var(--jj-logo)" } as React.CSSProperties}
                    />
                    <span className="text-base font-medium" style={{ color: "var(--jj-text)" }}>
                      Accuracy
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <PackageIcon
                      className="w-6 h-6"
                      style={{ color: "var(--jj-logo)" } as React.CSSProperties}
                    />
                    <span className="text-base font-medium" style={{ color: "var(--jj-text)" }}>
                      Delivery
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Spline 3D Robot — Frameless Floating Over Cyber-Green Grid */}
              <div className="relative h-[44vh] sm:h-[54vh] md:h-[600px] w-full flex items-center justify-center order-1 md:order-2">
                <div className="relative w-full h-full">
                  <div
                    className={`absolute -inset-6 rounded-full blur-3xl pointer-events-none ${landingStyles.heroGlow}`}
                    style={{ backgroundColor: "var(--jj-accent-soft)" }}
                  />
                  <div className="relative w-full h-full z-10">
                    <iframe
                      src="https://my.spline.design/genkubgreetingrobot-7FQGM1zpHhOXPrzWz2zcIDUe/"
                      frameBorder="0"
                      width="100%"
                      height="100%"
                      title="3D Greeting Robot Animation"
                      loading="eager"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 2. WHAT IT DELIVERS */}
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
                  What It Delivers
                </h2>
              </AnimatedSection>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                {[
                  {
                    icon: <CalendarDaysIcon />,
                    title: "20–100 Qualified Meetings/Month",
                  },
                  {
                    icon: <PhoneCallIcon />,
                    title: "30,000+ AI Cold Calls",
                    description: "Plus inbound assistance.",
                  },
                  {
                    icon: <CreditCardIcon />,
                    title: "$53K+ Monthly Revenue",
                    description: "Guaranteed predictable revenue.",
                  },
                  {
                    icon: <PackageIcon />,
                    title: "Done-For-You Growth",
                    description: "A true plug-and-play engine.",
                  },
                ].map((item, idx) => (
                  <AnimatedSection delay={idx * 100} key={item.title}>
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
                      {item.description && (
                        <p style={{ color: "var(--jj-muted)" }}>{item.description}</p>
                      )}
                    </div>
                  </AnimatedSection>
                ))}
              </div>
            </div>
          </section>

          {/* 3. WHY AI VOICE AGENTS WORK */}
          <section className="py-16 sm:py-20">
            <div className="container mx-auto px-6">
              <AnimatedSection>
                <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
                  Why AI Voice Agents Work
                </h2>
              </AnimatedSection>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {whyItWorksData.map((item, index) => (
                  <AnimatedSection delay={index * 90} key={item.title}>
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
                  The Clear Advantage
                </h2>
              </AnimatedSection>
              <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                <AnimatedSection delay={100}>
                  <div
                    className="p-7 rounded-xl border border-red-500/35 h-full shadow-lg"
                    style={{ backgroundColor: "var(--jj-primary)" }}
                  >
                    <h3 className="text-2xl font-bold mb-5 text-center">While others are...</h3>
                    <ul className="space-y-3.5" style={{ color: "var(--jj-muted)" }}>
                      <li className="flex items-start gap-3">
                        <MinusCircleIcon className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
                        <span>Struggling with manual cold calls</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <MinusCircleIcon className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
                        <span>Wrestling with complex CRMs</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <MinusCircleIcon className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
                        <span>Chasing dead-end leads</span>
                      </li>
                    </ul>
                  </div>
                </AnimatedSection>

                <AnimatedSection delay={200}>
                  <div
                    className="p-7 rounded-xl border border-[#9eff00]/45 h-full shadow-lg"
                    style={{ backgroundColor: "var(--jj-primary)" }}
                  >
                    <h3 className="text-2xl font-bold mb-5 text-center">You could be...</h3>
                    <ul className="space-y-3.5">
                      <li className="flex items-start gap-3">
                        <CheckBadgeIcon
                          className="w-6 h-6 flex-shrink-0 mt-0.5"
                          style={{ color: "var(--jj-accent)" } as React.CSSProperties}
                        />
                        <span>Landing premium clients effortlessly</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <CheckBadgeIcon
                          className="w-6 h-6 flex-shrink-0 mt-0.5"
                          style={{ color: "var(--jj-accent)" } as React.CSSProperties}
                        />
                        <span>Scaling your business predictably</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <CheckBadgeIcon
                          className="w-6 h-6 flex-shrink-0 mt-0.5"
                          style={{ color: "var(--jj-accent)" } as React.CSSProperties}
                        />
                        <span>Achieving growth — without the chaos</span>
                      </li>
                    </ul>
                  </div>
                </AnimatedSection>
              </div>
            </div>
          </section>

          {/* 5. PARTNERSHIP MODEL */}
          <section className="py-16 sm:py-20">
            <div className="container mx-auto px-6 text-center max-w-3xl">
              <AnimatedSection>
                <h2 className="text-3xl md:text-4xl font-bold mb-6">
                  🤝 A True Partnership Model
                </h2>
                <p className="text-lg mb-8" style={{ color: "var(--jj-muted)" }}>
                  We only win when you win. That&apos;s why our model is built on mutual success.
                </p>
                <div
                  className="inline-flex flex-col items-start gap-4 p-8 rounded-xl border"
                  style={{
                    backgroundColor: "var(--jj-primary)",
                    borderColor: "var(--jj-border)",
                  }}
                >
                  {[
                    "No high upfront fees",
                    "No complex setup process",
                    "No technical headaches",
                  ].map((line) => (
                    <p key={line} className="flex items-center gap-3 text-lg sm:text-xl">
                      <CheckBadgeIcon
                        className="w-6 h-6"
                        style={{ color: "var(--jj-accent)" } as React.CSSProperties}
                      />
                      <span>{line}</span>
                    </p>
                  ))}
                </div>
                <p className="text-2xl font-bold mt-8 italic">
                  Just pure, predictable growth.
                </p>
              </AnimatedSection>
            </div>
          </section>

          {/* 6. PROVEN RESULTS STATS COUNTER */}
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
                  Proven Results
                </h2>
              </AnimatedSection>
              <div className="flex flex-col md:flex-row justify-around text-center gap-10 md:gap-8">
                <StatItem value="100+" label="Qualified Meetings Booked" />
                <StatItem value="3+" label="Expert AI Partners Onboarded" />
                <StatItem value="$500K+" label="In Annualized Revenue for Clients" />
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

          {/* 8. VOICES OF SUCCESS — TESTIMONIALS */}
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
                  Voices of Success
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

          {/* 9. ISO 27001 SECURITY & TRUST */}
          <section className="py-16 sm:py-20">
            <div className="container mx-auto px-6 text-center max-w-3xl">
              <AnimatedSection>
                <h2 className="text-3xl md:text-4xl font-bold mb-8">
                  Our Commitment to Security &amp; Trust
                </h2>
                <div
                  className="inline-flex flex-col items-center gap-4 p-8 rounded-xl border shadow-lg"
                  style={{
                    backgroundColor: "var(--jj-primary)",
                    borderColor: "var(--jj-border)",
                  }}
                >
                  <IsoCertificateIcon
                    className="w-16 h-16"
                    style={{ color: "var(--jj-accent)" } as React.CSSProperties}
                  />
                  <p className="text-2xl font-bold mt-2">ISO 27001 Certified</p>
                  <p className="text-base sm:text-lg max-w-md" style={{ color: "var(--jj-muted)" }}>
                    Your data is protected with enterprise-grade security standards,
                    ensuring confidentiality, integrity, and availability.
                  </p>
                </div>
              </AnimatedSection>
            </div>
          </section>

          {/* 10. GET IN TOUCH */}
          <section
            className="py-20 sm:py-24 border-y"
            style={{
              backgroundColor: "var(--jj-secondary)",
              borderColor: "var(--jj-border)",
            }}
          >
            <div className="container mx-auto px-6 max-w-4xl text-center">
              <AnimatedSection>
                <h2 className="text-5xl md:text-6xl font-extrabold mb-4">
                  Get In Touch
                </h2>
                <p className="text-lg mb-10 max-w-2xl mx-auto" style={{ color: "var(--jj-muted)" }}>
                  Book an appointment to automate your sales, or test our live AI voice
                  agents directly in your browser.
                </p>
                <div className="mb-14">
                  <button
                    type="button"
                    onClick={() => openDemo()}
                    className="py-4 px-10 text-base sm:text-lg font-bold uppercase text-black bg-[#9eff00] hover:bg-[#bfff40] transition-all duration-300 hover:scale-105 cursor-pointer"
                    style={{
                      clipPath:
                        "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)",
                    }}
                  >
                    Book a Demo
                  </button>
                </div>

                <div className="flex flex-col md:flex-row justify-center items-center gap-10 md:gap-16">
                  <div className="flex items-center gap-4">
                    <EnvelopeIcon
                      className="w-9 h-9"
                      style={{ color: "var(--jj-accent)" } as React.CSSProperties}
                    />
                    <div className="text-left">
                      <h3 className="text-lg font-bold">Email Us</h3>
                      <a
                        href="mailto:vims20.vs@gmail.com"
                        className="hover:underline"
                        style={{ color: "var(--jj-muted)" }}
                      >
                        vims20.vs@gmail.com
                      </a>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <MapPinIcon
                      className="w-9 h-9"
                      style={{ color: "var(--jj-accent)" } as React.CSSProperties}
                    />
                    <div className="text-left">
                      <h3 className="text-lg font-bold">Our Location</h3>
                      <p style={{ color: "var(--jj-muted)" }}>Bangalore, India</p>
                    </div>
                  </div>
                </div>
              </AnimatedSection>
            </div>
          </section>

          {/* 11. FINAL PULSING CTA */}
          <AnimatedSection>
            <section className="py-20 sm:py-24 text-center">
              <div className="container mx-auto px-6">
                <h2 className="text-3xl sm:text-4xl md:text-5xl font-extrabold">
                  Ready to Scale?
                </h2>
                <p
                  className="my-6 text-lg max-w-2xl mx-auto"
                  style={{ color: "var(--jj-muted)" }}
                >
                  Automate your outreach, scale your business, and achieve predictable
                  growth with Jill-Jill AI Voice Agents.
                </p>
                <button
                  type="button"
                  onClick={() => openDemo()}
                  className={`uppercase bg-[#9eff00] hover:bg-[#bfff40] text-black font-bold py-4 px-10 text-lg sm:text-xl transition-all duration-300 hover:scale-105 cursor-pointer ${landingStyles.pulseGlowBtn}`}
                  style={{
                    clipPath:
                      "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)",
                  }}
                >
                  Automate Your Sales..
                </button>
              </div>
            </section>
          </AnimatedSection>
        </main>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer
        className="border-t py-8"
        style={{
          backgroundColor: "var(--jj-secondary)",
          borderColor: "var(--jj-border)",
          color: "var(--jj-muted)",
        }}
      >
        <div className="container mx-auto text-center text-sm space-y-2">
          <div className="mb-3">
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
          <p>Jill-Jill Powered by the VIMS Enterprise</p>
          <div className="pt-2 flex items-center justify-center gap-4">
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

      {/* ── Lead Capture + 9 Assistants + Live Voice Demo Modal ──────────────── */}
      <LeadAndDemoModal
        isOpen={isDemoModalOpen}
        onClose={() => setIsDemoModalOpen(false)}
        preselectedRole={preselectedRole}
      />

      {/* ── Floating Chatbot ─────────────────────────────────────────────────── */}
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
            Automate Your Sales..
          </button>
        </div>
      </section>
    </main>
  );
};

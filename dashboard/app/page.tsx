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
  MinusIcon,
  PlusIcon,
  ChevronDownIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  MinusCircleIcon,
  BellIcon,
  IsoCertificateIcon,
  Bars3Icon,
  XMarkIcon,
  LinkedInIcon,
  CheckIcon,
  TargetIcon,
  SunIcon,
  MoonIcon,
} from "@/components/landing/LandingIcons";
import { LeadAndDemoModal } from "@/components/landing/LeadAndDemoModal";
import { Chatbot } from "@/components/landing/Chatbot";

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

export default function LandingPage() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);
  const productDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedTheme = (localStorage.getItem("theme") as "dark" | "light") || "dark";
    setTheme(savedTheme);
    document.documentElement.setAttribute("data-theme", savedTheme);
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
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

  const productRoles = [
    "Call Receptionist",
    "Sales Caller",
    "Appointment Scheduler",
    "Debt Collection Agent",
    "Feedback Collector",
    "Survey Conductor",
    "Lead Qualifier",
    "Order Confirmation Bot",
    "Event Reminder Agent",
    "Clinic & Hospital Assistant",
  ];

  const whyItWorksData = [
    {
      icon: <ChatBubbleLeftRightIcon />,
      title: "Real Conversations, Real Results",
      description:
        "Natural-sounding AI agents that talk, qualify, and schedule meetings directly in your calendar with Gemini 3.1 Flash Live.",
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
        "Seamless integration with HubSpot, Zoho, Pipedrive, and PostgreSQL for an automated workflow.",
    },
    {
      icon: <LanguageIcon />,
      title: "Multi-Language Support",
      description:
        "Engage clients in their native language with fluent support for English, Tamil, Tanglish, and Hindi.",
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
        "Powered by Google Gemini 3.1 Flash Live to handle complex interactions and deliver zero-delay human-like voice.",
    },
  ];

  const faqData = [
    {
      question: "What are Jill-Jill AI Voice Agents?",
      answer:
        "Jill-Jill AI Voice Agents are real-time conversational agents built on LiveKit and Gemini 3.1 Flash Live. They automate customer calls, inbound support, appointment booking, and lead qualification with human-level fluency in English, Tamil, and Tanglish.",
    },
    {
      question: "Do I need technical skills to set it up?",
      answer:
        "No. Our platform is completely plug-and-play. You can choose from pre-built assistant stations or configure custom prompts, knowledge bases, and phone numbers directly from the dashboard.",
    },
    {
      question: "What CRMs does it integrate with?",
      answer:
        "Our system offers seamless integration with Supabase, PostgreSQL, HubSpot, Zoho, Pipedrive, and custom webhooks for instant notifications.",
    },
    {
      question: "Can I try out the voice agent right now?",
      answer:
        "Yes! Click 'Get a Free Demo' on this page, fill in your details, and test any of our 9 specialized voice assistants directly in your browser with real microphone audio.",
    },
  ];

  return (
    <div className="bg-[#030a01] text-[#e0e0e0] min-h-screen font-sans overflow-x-hidden selection:bg-[#9eff00] selection:text-black">
      {/* ── Top Header Navigation Bar ────────────────────────────────────────── */}
      <header className="py-2.5 px-4 sm:px-8 md:px-12 fixed top-0 left-0 right-0 bg-[#07090e]/85 backdrop-blur-md z-40 border-b border-white/10">
        <div className="container mx-auto flex justify-between items-center">
          {/* Logo with Bell icon */}
          <Link
            href="/"
            className="flex items-center gap-2 transition-transform duration-300 hover:scale-105"
            aria-label="Jill-Jill Home"
          >
            <BellIcon className="w-6 h-6 text-[#FFD600] animate-bounce" />
            <span className="text-xl font-black text-[#FFD600] tracking-wider">
              Jill-Jill
            </span>
          </Link>

          {/* Desktop Right Navigation */}
          <div className="hidden md:flex items-center gap-5">
            {/* Products Dropdown */}
            <div ref={productDropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setIsProductDropdownOpen(!isProductDropdownOpen)}
                className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-gray-300 hover:text-white transition-colors uppercase"
              >
                <span>PRODUCTS</span>
                <ChevronDownIcon
                  className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
                    isProductDropdownOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {isProductDropdownOpen && (
                <div className="absolute top-full right-0 mt-3 w-64 bg-[#0d1020] border border-white/10 rounded-xl shadow-2xl p-2 z-50">
                  <ul className="text-xs space-y-1">
                    {productRoles.map((role) => (
                      <li key={role}>
                        <button
                          type="button"
                          onClick={() => {
                            setIsProductDropdownOpen(false);
                            setIsDemoModalOpen(true);
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg text-gray-300 hover:bg-white/10 hover:text-[#9eff00] transition-colors"
                        >
                          {role}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* DASHBOARD Link Button (Opens Admin Portal) */}
            <Link
              href="/overview"
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold tracking-wider text-gray-200 hover:text-[#9eff00] bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[#9eff00]/40 transition-all uppercase"
              title="Open Admin Dashboard"
            >
              <LayoutDashboardIcon className="w-4 h-4 text-[#9eff00]" />
              <span>DASHBOARD</span>
            </Link>

            {/* Theme Toggle Button */}
            <button
              type="button"
              onClick={toggleTheme}
              className="p-1.5 rounded-full text-gray-400 hover:text-[#9eff00] transition-colors"
              aria-label="Toggle Theme"
            >
              {theme === "dark" ? (
                <SunIcon className="w-5 h-5" />
              ) : (
                <MoonIcon className="w-5 h-5" />
              )}
            </button>

            {/* AUTOMATE YOUR SALES CTA Button */}
            <button
              type="button"
              onClick={() => setIsDemoModalOpen(true)}
              className="px-5 py-2 rounded-none bg-[#9eff00] hover:bg-[#bfff40] text-black font-extrabold text-xs uppercase tracking-wider shadow-[0_0_20px_rgba(158,255,0,0.3)] hover:scale-105 transition-all cursor-pointer"
              style={{
                clipPath:
                  "polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)",
              }}
            >
              AUTOMATE YOUR SALES..
            </button>
          </div>

          {/* Mobile Menu Icon */}
          <div className="flex items-center gap-2 md:hidden">
            <Link
              href="/overview"
              className="px-2.5 py-1 rounded bg-white/10 text-xs font-bold text-[#9eff00]"
            >
              DASHBOARD
            </Link>
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 text-white"
              aria-label="Toggle menu"
            >
              {isMobileMenuOpen ? (
                <XMarkIcon className="w-6 h-6" />
              ) : (
                <Bars3Icon className="w-6 h-6" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Panel */}
        {isMobileMenuOpen && (
          <div className="md:hidden mt-3 pt-3 border-t border-white/10 pb-4 space-y-3 px-2">
            <Link
              href="/overview"
              onClick={() => setIsMobileMenuOpen(false)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 text-sm font-semibold text-white"
            >
              <LayoutDashboardIcon className="w-4 h-4 text-[#9eff00]" />
              <span>Admin Dashboard</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                setIsMobileMenuOpen(false);
                setIsDemoModalOpen(true);
              }}
              className="w-full text-left px-3 py-2 rounded-lg bg-[#9eff00] text-black text-sm font-bold uppercase"
            >
              Get A Free Demo
            </button>
          </div>
        )}
      </header>

      {/* ── Main Hero Section ────────────────────────────────────────────────── */}
      <main className="pt-20">
        <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center min-h-[calc(100vh-8rem)]">
            {/* Left Content Column */}
            <div className="lg:col-span-7 space-y-6 text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#9eff00]/10 border border-[#9eff00]/30 text-xs font-semibold text-[#9eff00]">
                <span>●</span>
                <span>#1 Rated Human-like AI Voice Agents</span>
              </div>

              <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
                Build Your Ready-to-Work AI <br className="hidden sm:inline" />
                Voice Agent in Just{" "}
                <span className="relative inline-block text-[#FFD600]">
                  1 Week
                  <svg
                    className="absolute -bottom-2 left-0 w-full text-[#FFD600]"
                    viewBox="0 0 150 12"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M3 9.5C25 5.5 110 1 147 9.5"
                      stroke="currentColor"
                      strokeWidth="5"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </h1>

              <p className="text-sm sm:text-base text-gray-300 max-w-xl leading-relaxed">
                Create intelligent, human-like AI voice agents for B2B sales, customer
                support, appointment booking and lead qualification. Built to outperform
                human agents with zero awkward delay.
              </p>

              {/* Feature Checklist */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 pt-2">
                {[
                  "Real-time Human Like Voice",
                  "Unlock 5x Productivity",
                  "Powered by Gemini 3.1 Flash Live",
                  "Automated Call Workflow",
                  "Enterprise-grade Security",
                  "Zero Missed Calls",
                ].map((feat) => (
                  <div key={feat} className="flex items-center gap-2.5">
                    <div className="h-5 w-5 rounded-md bg-[#9eff00]/20 flex items-center justify-center flex-shrink-0">
                      <CheckIcon className="w-3.5 h-3.5 text-[#9eff00]" />
                    </div>
                    <span className="text-xs sm:text-sm font-medium text-gray-200">
                      {feat}
                    </span>
                  </div>
                ))}
              </div>

              {/* CTA Button */}
              <div className="pt-4 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => setIsDemoModalOpen(true)}
                  className="px-8 py-3.5 bg-[#9eff00] hover:bg-[#bfff40] text-black font-black text-sm uppercase tracking-wider shadow-[0_0_30px_rgba(158,255,0,0.4)] hover:scale-105 transition-all cursor-pointer"
                  style={{
                    clipPath:
                      "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)",
                  }}
                >
                  GET A FREE DEMO
                </button>
              </div>

              {/* Badges */}
              <div className="flex flex-wrap items-center gap-6 sm:gap-10 pt-4 text-xs font-semibold text-gray-300">
                <div className="flex items-center gap-2 text-[#FFD600]">
                  <IsoCertificateIcon className="w-5 h-5 text-[#FFD600]" />
                  <span className="text-white">Trust</span>
                </div>
                <div className="flex items-center gap-2 text-[#FFD600]">
                  <TargetIcon className="w-5 h-5 text-[#FFD600]" />
                  <span className="text-white">Accuracy</span>
                </div>
                <div className="flex items-center gap-2 text-[#FFD600]">
                  <PackageIcon className="w-5 h-5 text-[#FFD600]" />
                  <span className="text-white">Delivery</span>
                </div>
              </div>
            </div>

            {/* Right Spline 3D Robot Animation */}
            <div className="lg:col-span-5 relative w-full h-[380px] sm:h-[480px] lg:h-[560px] flex items-center justify-center">
              {/* Outer Glow */}
              <div className="absolute inset-0 bg-[#9eff00]/10 rounded-full blur-3xl pointer-events-none" />

              {/* Spline Iframe Container */}
              <div className="relative w-full h-full rounded-3xl overflow-hidden border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.8)]">
                <iframe
                  src="https://my.spline.design/genkubgreetingrobot-7FQGM1zpHhOXPrzWz2zcIDUe/"
                  frameBorder="0"
                  width="100%"
                  height="100%"
                  title="3D Greeting Robot Animation"
                  loading="lazy"
                  className="w-full h-full"
                />
              </div>

              {/* Spline Badge */}
              <div className="absolute bottom-3 right-3 px-3 py-1 rounded-full bg-black/70 backdrop-blur-md border border-white/10 text-[10px] text-gray-400 flex items-center gap-1.5 pointer-events-none">
                <span className="h-2 w-2 rounded-full bg-[#9eff00]" />
                <span>Built with Spline</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── What It Delivers Section ────────────────────────────────────────── */}
        <section className="py-16 sm:py-20 bg-[#070a04] border-y border-white/5">
          <div className="container mx-auto px-6">
            <AnimatedSection>
              <h2 className="text-2xl sm:text-4xl font-extrabold text-white text-center mb-12">
                What It Delivers
              </h2>
            </AnimatedSection>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                {
                  icon: <CalendarDaysIcon className="w-10 h-10 text-[#9eff00]" />,
                  title: "20–100 Qualified Meetings/Month",
                  desc: "Direct calendar bookings while you sleep.",
                },
                {
                  icon: <PhoneCallIcon className="w-10 h-10 text-[#9eff00]" />,
                  title: "30,000+ AI Cold Calls",
                  desc: "Plus inbound assistance and triage.",
                },
                {
                  icon: <CreditCardIcon className="w-10 h-10 text-[#9eff00]" />,
                  title: "$53K+ Monthly Revenue",
                  desc: "Predictable revenue pipeline acceleration.",
                },
                {
                  icon: <PackageIcon className="w-10 h-10 text-[#9eff00]" />,
                  title: "Done-For-You Growth",
                  desc: "A true plug-and-play voice automation engine.",
                },
              ].map((item, idx) => (
                <AnimatedSection delay={idx * 100} key={item.title}>
                  <div className="bg-[#0b1007] p-6 rounded-2xl border border-white/5 hover:border-[#9eff00]/40 transition-all text-center h-full hover:-translate-y-1">
                    <div className="mx-auto mb-4 flex items-center justify-center">
                      {item.icon}
                    </div>
                    <h3 className="text-base sm:text-lg font-bold text-white mb-2">
                      {item.title}
                    </h3>
                    <p className="text-xs text-gray-400">{item.desc}</p>
                  </div>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </section>

        {/* ── Why AI Voice Agents Work ────────────────────────────────────────── */}
        <section className="py-16 sm:py-20">
          <div className="container mx-auto px-6">
            <AnimatedSection>
              <h2 className="text-2xl sm:text-4xl font-extrabold text-white text-center mb-12">
                Why AI Voice Agents Work
              </h2>
            </AnimatedSection>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {whyItWorksData.map((item, index) => (
                <AnimatedSection delay={index * 80} key={item.title}>
                  <div className="bg-[#0a0e08] p-6 rounded-2xl border border-white/5 hover:border-[#9eff00]/40 transition-all h-full">
                    <div className="text-[#9eff00] mb-4">{item.icon}</div>
                    <h3 className="text-base sm:text-lg font-bold text-white mb-2">
                      {item.title}
                    </h3>
                    <p className="text-xs sm:text-sm text-gray-400 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </section>

        {/* ── The Clear Advantage ─────────────────────────────────────────────── */}
        <section className="py-16 sm:py-20 bg-[#070a04] border-y border-white/5">
          <div className="container mx-auto px-6">
            <AnimatedSection>
              <h2 className="text-2xl sm:text-4xl font-extrabold text-white text-center mb-12">
                The Clear Advantage
              </h2>
            </AnimatedSection>
            <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
              <div className="bg-[#12080a] p-6 rounded-2xl border border-red-500/30">
                <h3 className="text-lg font-bold text-white mb-4 text-center">
                  While others are...
                </h3>
                <ul className="space-y-3 text-xs sm:text-sm text-gray-400">
                  <li className="flex items-center gap-3">
                    <MinusCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0" />
                    <span>Struggling with manual cold calls & high turnover</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <MinusCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0" />
                    <span>Wrestling with complex un-integrated CRMs</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <MinusCircleIcon className="w-5 h-5 text-red-500 flex-shrink-0" />
                    <span>Missing 60% of after-hours inbound enquiries</span>
                  </li>
                </ul>
              </div>

              <div className="bg-[#091407] p-6 rounded-2xl border border-[#9eff00]/40 shadow-[0_0_30px_rgba(158,255,0,0.1)]">
                <h3 className="text-lg font-bold text-white mb-4 text-center">
                  You could be...
                </h3>
                <ul className="space-y-3 text-xs sm:text-sm text-gray-200">
                  <li className="flex items-center gap-3">
                    <CheckIcon className="w-5 h-5 text-[#9eff00] flex-shrink-0" />
                    <span>Running 24/7 automated qualification on autopilot</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <CheckIcon className="w-5 h-5 text-[#9eff00] flex-shrink-0" />
                    <span>Instantly syncing calls into your database & calendar</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <CheckIcon className="w-5 h-5 text-[#9eff00] flex-shrink-0" />
                    <span>Delivering natural Tamil, English, and Tanglish support</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── FAQ Section ─────────────────────────────────────────────────────── */}
        <section className="py-16 sm:py-20">
          <div className="container mx-auto px-6 max-w-3xl">
            <AnimatedSection>
              <h2 className="text-2xl sm:text-4xl font-extrabold text-white text-center mb-10">
                Frequently Asked Questions
              </h2>
            </AnimatedSection>
            <div className="space-y-4">
              {faqData.map((faq, idx) => (
                <FaqAccordionItem key={faq.question} question={faq.question} answer={faq.answer} />
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="py-10 border-t border-white/10 bg-[#020501] text-xs text-gray-500 text-center">
        <div className="container mx-auto px-6 space-y-3">
          <div className="flex justify-center">
            <a
              href="https://www.linkedin.com/in/vims-enterprise-4898b1314"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 hover:text-white transition-colors"
              aria-label="LinkedIn"
            >
              <LinkedInIcon className="w-5 h-5" />
            </a>
          </div>
          <p>© {new Date().getFullYear()} Jill-Jill. All rights reserved.</p>
          <p className="text-gray-400">Jill-Jill Powered by the VIMS Enterprise</p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setIsPrivacyOpen(true)}
              className="text-gray-400 hover:text-white underline cursor-pointer"
            >
              Privacy Policy
            </button>
          </div>
        </div>
      </footer>

      {/* ── Modals & Floating Chatbot ────────────────────────────────────────── */}
      <LeadAndDemoModal
        isOpen={isDemoModalOpen}
        onClose={() => setIsDemoModalOpen(false)}
      />

      {isPrivacyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-[#0e1220] border border-white/10 rounded-2xl max-w-lg w-full p-6 text-white text-xs space-y-4">
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <h3 className="text-sm font-bold">Privacy Policy</h3>
              <button
                type="button"
                onClick={() => setIsPrivacyOpen(false)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <p className="text-gray-300 leading-relaxed">
              Jill-Jill and VIMS Enterprise value your privacy. We process voice recordings and
              lead information solely for demonstrating AI voice services and managing CRM
              workflows. We do not sell your personal data.
            </p>
            <div className="text-right">
              <button
                type="button"
                onClick={() => setIsPrivacyOpen(false)}
                className="px-4 py-1.5 rounded-lg bg-[#9eff00] text-black font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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
    <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex justify-between items-center text-left py-4 px-5 text-sm sm:text-base font-semibold text-white hover:bg-white/[0.04] transition-colors"
      >
        <span>{question}</span>
        <span className="text-[#9eff00] ml-4">
          {isOpen ? <MinusIcon className="w-5 h-5" /> : <PlusIcon className="w-5 h-5" />}
        </span>
      </button>
      {isOpen && (
        <div className="px-5 pb-4 text-xs sm:text-sm text-gray-400 border-t border-white/5 pt-3 leading-relaxed">
          {answer}
        </div>
      )}
    </div>
  );
};

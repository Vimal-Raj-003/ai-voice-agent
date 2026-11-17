"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  LogoIcon,
  ProfessionalAvatarIcon,
  PaperAirplaneIcon,
  XMarkIcon,
} from "./LandingIcons";

interface ChatMessage {
  sender: "user" | "bot";
  text: string;
}

const initialChatState: ChatMessage[] = [];

const getUserId = () => {
  if (typeof window === "undefined") return "user_ssr";
  let userId = localStorage.getItem("jilljill_chatbot_userId");
  if (!userId) {
    userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem("jilljill_chatbot_userId", userId);
  }
  return userId;
};

export const Chatbot: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>(initialChatState);
  const [isSending, setIsSending] = useState(false);
  const [sessionId, setSessionId] = useState("");

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

  useEffect(() => {
    if (isOpen) {
      setChatHistory([]);
      setIsSending(true);

      const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      setSessionId(newSessionId);

      setTimeout(() => inputRef.current?.focus(), 300);

      const fetchWelcomeMessage = async () => {
        try {
          const userId = getUserId();
          const response = await fetch(
            "https://vims.ascendwithasvin.com/webhook/335cbb18-10a2-45d7-9ec0-9c414cbfbcf4",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                message: "START_CONVERSATION",
                userId: userId,
                sessionId: newSessionId,
              }),
            }
          );

          if (!response.ok) {
            throw new Error(`Webhook status: ${response.status}`);
          }

          const responseData = await response.json();
          const botReplyText = responseData.reply;

          if (typeof botReplyText === "string" && botReplyText.trim()) {
            setChatHistory([{ sender: "bot", text: botReplyText }]);
          } else {
            setChatHistory([
              { sender: "bot", text: "Hello! How can I assist you with Jill-Jill AI Voice Agents today?" },
            ]);
          }
        } catch {
          setChatHistory([
            { sender: "bot", text: "Hello! How can I help you explore Jill-Jill AI Voice Agents today?" },
          ]);
        } finally {
          setIsSending(false);
        }
      };

      fetchWelcomeMessage();
    }
  }, [isOpen]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isSending) return;

    setIsSending(true);
    const userMessage: ChatMessage = { sender: "user", text: message };
    setChatHistory((prev) => [...prev, userMessage]);
    setMessage("");

    try {
      const userId = getUserId();
      const response = await fetch(
        "https://vims.ascendwithasvin.com/webhook/335cbb18-10a2-45d7-9ec0-9c414cbfbcf4",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userMessage.text,
            userId: userId,
            sessionId: sessionId,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Webhook response status: ${response.status}`);
      }

      const responseData = await response.json();
      const botReplyText = responseData.reply;

      if (typeof botReplyText === "string" && botReplyText.trim()) {
        setChatHistory((prev) => [...prev, { sender: "bot", text: botReplyText }]);
      } else {
        setChatHistory((prev) => [
          ...prev,
          { sender: "bot", text: "Thanks! We've received your query and will connect shortly." },
        ]);
      }
    } catch {
      setChatHistory((prev) => [
        ...prev,
        {
          sender: "bot",
          text: "Thanks for reaching out! Tap 'Book a Live Demo' above to speak live with our voice agents right now.",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleEndChat = async () => {
    if (chatHistory.length > 0) {
      try {
        const userId = getUserId();
        await fetch("https://vims.ascendwithasvin.com/webhook/335cbb18-10a2-45d7-9ec0-9c414cbfbcf4", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "User has ended the conversation.",
            userId: userId,
            sessionId: sessionId,
          }),
          keepalive: true,
        });
      } catch {
        // ignore
      }
    }
    setIsOpen(false);
  };

  return (
    <>
      <div
        className={`fixed bottom-24 right-4 sm:right-6 w-[calc(100vw-2rem)] max-w-sm h-[58dvh] max-h-[480px] bg-[#111c30]/95 backdrop-blur-xl border border-teal-400/25 rounded-2xl shadow-2xl flex flex-col transition-all duration-300 ease-in-out origin-bottom-right z-40 ${
          isOpen ? "scale-100 opacity-100" : "scale-95 opacity-0 pointer-events-none"
        }`}
        style={{ WebkitBackdropFilter: "blur(16px)" }}
        role="dialog"
        aria-hidden={!isOpen}
      >
        <header className="flex items-center justify-between p-3.5 border-b border-teal-400/20 flex-shrink-0">
          <div className="flex items-center gap-3">
            <ProfessionalAvatarIcon className="w-9 h-9 text-teal-300" />
            <div>
              <h2 className="font-bold text-white text-sm">Jill-Jill Concierge</h2>
              <p className="text-xs text-slate-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
                Online
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleEndChat}
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-full text-slate-300 hover:bg-white/10 hover:text-white transition-colors touch-manipulation"
            aria-label="Close chat"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </header>

        <div
          ref={chatContainerRef}
          className="flex-grow p-4 overflow-y-auto space-y-3"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {chatHistory.map((chat, index) => (
            <div
              key={index}
              className={`flex gap-2.5 items-end ${
                chat.sender === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {chat.sender === "bot" && (
                <ProfessionalAvatarIcon className="w-7 h-7 text-teal-300 flex-shrink-0" />
              )}
              <div
                className={`max-w-[82%] text-xs sm:text-sm px-3.5 py-2.5 rounded-2xl leading-relaxed ${
                  chat.sender === "user"
                    ? "bg-teal-400 text-teal-950 font-semibold rounded-br-none"
                    : "bg-[#192946] border border-teal-400/15 text-slate-100 rounded-bl-none"
                }`}
              >
                <p>{chat.text}</p>
              </div>
            </div>
          ))}
          {isSending && (
            <div className="flex gap-2.5 justify-start">
              <ProfessionalAvatarIcon className="w-7 h-7 text-teal-300 flex-shrink-0" />
              <div className="px-3.5 py-2.5 rounded-2xl bg-[#192946] text-slate-300 rounded-bl-none flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-pulse" />
                <span className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-pulse [animation-delay:0.15s]" />
                <span className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-pulse [animation-delay:0.3s]" />
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={handleSendMessage}
          className="p-3 border-t border-teal-400/20 flex items-center gap-2 flex-shrink-0"
        >
          <input
            ref={inputRef}
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Ask a question..."
            className="w-full bg-[#17253e] border border-slate-700/80 rounded-xl py-2 px-3 text-base sm:text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-400 transition-all"
            disabled={isSending}
          />
          <button
            type="submit"
            disabled={isSending || !message.trim()}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-teal-400 text-teal-950 hover:bg-teal-300 disabled:bg-slate-600 disabled:cursor-not-allowed transition-all touch-manipulation"
            aria-label="Send message"
          >
            <PaperAirplaneIcon className="w-4 h-4" />
          </button>
        </form>
      </div>

      <div
        className="fixed right-4 sm:right-6 z-40"
        style={{ bottom: "max(1.25rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <button
          type="button"
          onClick={() => (isOpen ? handleEndChat() : setIsOpen(true))}
          className="w-12 h-12 bg-teal-400 hover:bg-teal-300 rounded-full text-teal-950 flex items-center justify-center shadow-[0_8px_22px_rgba(20,184,166,0.32)] active:scale-95 focus:outline-none transition-all cursor-pointer touch-manipulation"
          aria-label={isOpen ? "Close chat" : "Open chat"}
        >
          <div className="relative w-6 h-6 flex items-center justify-center">
            {isOpen ? (
              <XMarkIcon className="w-6 h-6 text-teal-950" />
            ) : (
              <LogoIcon className="w-6 h-6 text-teal-950" />
            )}
          </div>
        </button>
      </div>
    </>
  );
};

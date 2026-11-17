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
          text: "Thanks for reaching out! You can click 'Get A Free Demo' above to test a live call with our voice agents right now.",
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
      {/* Chat Window */}
      <div
        className={`fixed bottom-24 right-4 sm:right-6 w-[calc(100vw-2rem)] max-w-sm h-[60vh] max-h-[500px] bg-black/80 backdrop-blur-xl border border-gray-700/50 rounded-2xl shadow-2xl flex flex-col transition-all duration-300 ease-in-out origin-bottom-right z-50 ${
          isOpen ? "scale-100 opacity-100" : "scale-95 opacity-0 pointer-events-none"
        }`}
        role="dialog"
        aria-hidden={!isOpen}
      >
        {/* Header */}
        <header className="flex items-center justify-between p-3.5 border-b border-gray-700/50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <ProfessionalAvatarIcon className="w-9 h-9 text-[#9eff00]" />
            <div>
              <h2 className="font-bold text-white text-sm">Jill-Jill Support</h2>
              <p className="text-xs text-gray-400 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Online
              </p>
            </div>
          </div>
          <button
            onClick={handleEndChat}
            className="p-1 rounded-full text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Close chat"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </header>

        {/* Messages */}
        <div ref={chatContainerRef} className="flex-grow p-4 overflow-y-auto space-y-3">
          {chatHistory.map((chat, index) => (
            <div
              key={index}
              className={`flex gap-2.5 items-end ${
                chat.sender === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {chat.sender === "bot" && (
                <ProfessionalAvatarIcon className="w-7 h-7 text-[#9eff00] flex-shrink-0" />
              )}
              <div
                className={`max-w-[80%] text-xs sm:text-sm px-3.5 py-2.5 rounded-2xl leading-relaxed ${
                  chat.sender === "user"
                    ? "bg-[#9eff00] text-black font-medium rounded-br-none"
                    : "bg-[#161a30] border border-white/5 text-gray-200 rounded-bl-none"
                }`}
              >
                <p>{chat.text}</p>
              </div>
            </div>
          ))}
          {isSending && (
            <div className="flex gap-2.5 justify-start">
              <ProfessionalAvatarIcon className="w-7 h-7 text-[#9eff00] flex-shrink-0" />
              <div className="px-3.5 py-2.5 rounded-2xl bg-[#161a30] text-gray-300 rounded-bl-none flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse [animation-delay:0.15s]" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse [animation-delay:0.3s]" />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={handleSendMessage}
          className="p-3 border-t border-gray-700/50 flex items-center gap-2 flex-shrink-0"
        >
          <input
            ref={inputRef}
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type your message..."
            className="w-full bg-[#161a30] border border-gray-600/60 rounded-xl py-2 px-3 text-xs sm:text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#9eff00] transition-all"
            disabled={isSending}
          />
          <button
            type="submit"
            disabled={isSending || !message.trim()}
            className="p-2.5 rounded-xl bg-[#9eff00] text-black hover:bg-[#bfff40] hover:scale-105 disabled:bg-gray-600 disabled:cursor-not-allowed transition-all"
            aria-label="Send message"
          >
            <PaperAirplaneIcon className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* Floating Action Button */}
      <div className="fixed bottom-6 right-4 sm:right-6 z-50">
        <button
          onClick={() => (isOpen ? handleEndChat() : setIsOpen(true))}
          className="w-12 h-12 bg-[#9eff00] hover:bg-[#bfff40] rounded-full text-black flex items-center justify-center shadow-lg shadow-[#9eff00]/30 hover:scale-110 focus:outline-none transition-all cursor-pointer"
          aria-label={isOpen ? "Close chat" : "Open chat"}
        >
          <div className="relative w-6 h-6 flex items-center justify-center">
            {isOpen ? (
              <XMarkIcon className="w-6 h-6 text-black" />
            ) : (
              <LogoIcon className="w-6 h-6 text-black" />
            )}
          </div>
        </button>
      </div>
    </>
  );
};

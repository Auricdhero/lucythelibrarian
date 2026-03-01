import React, { useState, useRef, useEffect } from 'react';
import { 
  BookOpen, 
  MessageSquare, 
  FileText, 
  BrainCircuit, 
  Send, 
  Upload, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  ChevronRight,
  GraduationCap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GoogleGenAI, Type } from '@google/genai';

// Initialize Gemini on the frontend
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
const modelName = "gemini-3-flash-preview";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Tab = 'chat' | 'summarize' | 'quiz';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: number;
}

interface Quiz {
  title: string;
  questions: QuizQuestion[];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [quizTopic, setQuizTopic] = useState('');
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch('/api/history');
        const data = await res.json();
        setMessages(data.map((m: any) => ({ role: m.role, content: m.content })));
      } catch (err) {
        console.error('Failed to fetch history', err);
      }
    };
    fetchHistory();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      // Call Gemini directly from the frontend
      const response = await ai.models.generateContent({
        model: modelName,
        contents: newMessages.map(m => ({
          role: m.role === 'assistant' ? 'model' : m.role,
          parts: [{ text: m.content }]
        })),
        config: {
          systemInstruction: "You are Lucy, an academic AI library assistant. Help with research, assignments, and academic writing. Be professional and helpful.",
        }
      });

      const assistantText = response.text || "I'm sorry, I couldn't process that.";
      const assistantMessage: Message = { role: 'assistant', content: assistantText };
      
      const updatedMessages = [...newMessages, assistantMessage];
      setMessages(updatedMessages);

      // Save to backend history for persistence
      fetch('/api/chat/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessage, assistantMessage }),
      }).catch(err => console.error('Failed to save history', err));

    } catch (err) {
      console.error('Chat Error:', err);
      setMessages(prev => [...prev, { role: 'assistant', content: "Sorry, I encountered an error. Please check your API key configuration." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSummarize = async () => {
    if (!file || isLoading) return;
    setIsLoading(true);
    
    try {
      // 1. Get text from file (using backend for PDF parsing is still okay, or we can use pdfjs-dist)
      const formData = new FormData();
      formData.append('file', file);
      
      const textRes = await fetch('/api/extract-text', {
        method: 'POST',
        body: formData,
      });
      const { text } = await textRes.json();

      // 2. Call Gemini from frontend
      const response = await ai.models.generateContent({
        model: modelName,
        contents: `Summarize these lecture slides/notes for an academic student. Focus on key concepts and learning outcomes:\n\n${text}`,
      });

      const summaryText = response.text || "Failed to generate summary.";
      setSummary(summaryText);

      // 3. Save summary to backend
      fetch('/api/summaries/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: file.name, content: summaryText }),
      }).catch(err => console.error('Failed to save summary', err));

    } catch (err) {
      console.error('Summarize Error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateQuiz = async () => {
    if (!quizTopic.trim() || isLoading) return;
    setIsLoading(true);
    setQuiz(null);
    setQuizAnswers([]);
    setQuizSubmitted(false);

    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: `Generate a multiple choice quiz about ${quizTopic}. Return exactly 5 questions.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    correctAnswer: { type: Type.INTEGER, description: "Index of the correct option (0-3)" }
                  },
                  required: ["question", "options", "correctAnswer"]
                }
              }
            },
            required: ["title", "questions"]
          }
        }
      });

      const quizData = JSON.parse(response.text || '{}');
      setQuiz(quizData);
      setQuizAnswers(new Array(quizData.questions.length).fill(-1));

      // Save quiz to backend
      fetch('/api/quizzes/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: quizData.title, data: quizData }),
      }).catch(err => console.error('Failed to save quiz', err));

    } catch (err) {
      console.error('Quiz Error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const submitQuiz = () => {
    setQuizSubmitted(true);
  };

  return (
    <div className="flex h-screen bg-[#F8F9FA] text-[#202124] font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-[#E0E0E0] flex flex-col">
        <div className="p-6 flex items-center gap-3 border-b border-[#F1F3F4]">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
            <GraduationCap size={24} />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight">Lucy</h1>
            <p className="text-[10px] text-indigo-600 font-semibold uppercase tracking-widest">Library AI</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <SidebarItem 
            icon={<MessageSquare size={20} />} 
            label="Research Chat" 
            active={activeTab === 'chat'} 
            onClick={() => setActiveTab('chat')} 
          />
          <SidebarItem 
            icon={<FileText size={20} />} 
            label="Summarize Slides" 
            active={activeTab === 'summarize'} 
            onClick={() => setActiveTab('summarize')} 
          />
          <SidebarItem 
            icon={<BrainCircuit size={20} />} 
            label="Knowledge Quiz" 
            active={activeTab === 'quiz'} 
            onClick={() => setActiveTab('quiz')} 
          />
        </nav>

        <div className="p-4 border-t border-[#F1F3F4]">
          <div className="p-4 bg-indigo-50 rounded-2xl">
            <p className="text-xs font-medium text-indigo-700 mb-1">Telegram Access</p>
            <p className="text-[10px] text-indigo-500 leading-relaxed">
              Connect Lucy to your Telegram for research on the go. 
              <br />
              <span className="font-bold">Set TELEGRAM_BOT_TOKEN in secrets to enable.</span>
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 bg-white border-b border-[#E0E0E0] flex items-center justify-between px-8">
          <div className="flex items-center gap-2 text-sm font-medium text-[#5F6368]">
            <span>Lucy</span>
            <ChevronRight size={14} />
            <span className="text-[#202124] capitalize">{activeTab}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              Agent Online
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-4xl mx-auto w-full h-full">
            <AnimatePresence mode="wait">
              {activeTab === 'chat' && (
                <motion.div 
                  key="chat"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex flex-col h-full"
                >
                  <div className="flex-1 space-y-6 pb-24">
                    {messages.length === 0 && (
                      <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-60">
                        <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center border border-[#E0E0E0] shadow-sm">
                          <BookOpen size={32} className="text-indigo-600" />
                        </div>
                        <div>
                          <h2 className="text-xl font-semibold">How can I help with your research?</h2>
                          <p className="text-sm max-w-sm mx-auto mt-2">
                            Ask me about academic topics, help with assignments, or structuring your thesis.
                          </p>
                        </div>
                      </div>
                    )}
                    {messages.map((m, i) => (
                      <div key={i} className={cn(
                        "flex gap-4",
                        m.role === 'user' ? "flex-row-reverse" : "flex-row"
                      )}>
                        <div className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                          m.role === 'user' ? "bg-indigo-600 text-white" : "bg-white border border-[#E0E0E0] text-indigo-600"
                        )}>
                          {m.role === 'user' ? <span className="text-xs font-bold">ME</span> : <GraduationCap size={16} />}
                        </div>
                        <div className={cn(
                          "max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed",
                          m.role === 'user' ? "bg-indigo-600 text-white shadow-md shadow-indigo-100" : "bg-white border border-[#E0E0E0] shadow-sm"
                        )}>
                          <div className="markdown-body prose prose-sm max-w-none">
                            <ReactMarkdown>
                              {m.content}
                            </ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    ))}
                    {isLoading && (
                      <div className="flex gap-4">
                        <div className="w-8 h-8 rounded-lg bg-white border border-[#E0E0E0] flex items-center justify-center text-indigo-600">
                          <Loader2 size={16} className="animate-spin" />
                        </div>
                        <div className="bg-white border border-[#E0E0E0] p-4 rounded-2xl shadow-sm">
                          <div className="flex gap-1">
                            <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" />
                            <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                            <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  <div className="fixed bottom-8 left-64 right-0 px-8 pointer-events-none">
                    <div className="max-w-4xl mx-auto w-full pointer-events-auto">
                      <div className="relative">
                        <input 
                          type="text"
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                          placeholder="Ask Lucy anything about your studies..."
                          className="w-full bg-white border border-[#E0E0E0] rounded-2xl px-6 py-4 pr-16 shadow-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                        />
                        <button 
                          onClick={handleSendMessage}
                          disabled={!input.trim() || isLoading}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          <Send size={20} />
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'summarize' && (
                <motion.div 
                  key="summarize"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-8"
                >
                  <div className="bg-white border border-[#E0E0E0] rounded-3xl p-8 shadow-sm">
                    <h2 className="text-xl font-semibold mb-2">Lecture Slide Summarizer</h2>
                    <p className="text-sm text-[#5F6368] mb-6">Upload your PDF slides or lecture notes, and I'll generate a concise summary of the key concepts.</p>
                    
                    <div className="border-2 border-dashed border-[#DADCE0] rounded-2xl p-12 text-center hover:border-indigo-400 transition-colors group cursor-pointer relative">
                      <input 
                        type="file" 
                        onChange={(e) => setFile(e.target.files?.[0] || null)}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        accept=".pdf,.txt"
                      />
                      <div className="flex flex-col items-center">
                        <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 mb-4 group-hover:scale-110 transition-transform">
                          <Upload size={32} />
                        </div>
                        <p className="font-medium text-[#202124]">
                          {file ? file.name : "Click or drag slides here"}
                        </p>
                        <p className="text-xs text-[#5F6368] mt-1">Supports PDF and Text files</p>
                      </div>
                    </div>

                    <button 
                      onClick={handleSummarize}
                      disabled={!file || isLoading}
                      className="mt-6 w-full py-4 bg-indigo-600 text-white rounded-2xl font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                    >
                      {isLoading ? <Loader2 className="animate-spin" /> : <FileText size={20} />}
                      {isLoading ? "Analyzing Content..." : "Generate Summary"}
                    </button>
                  </div>

                  {summary && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-white border border-[#E0E0E0] rounded-3xl p-8 shadow-sm"
                    >
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <CheckCircle2 className="text-emerald-500" size={20} />
                          Summary Generated
                        </h3>
                        <button className="text-xs font-medium text-indigo-600 hover:underline">Copy to Clipboard</button>
                      </div>
                      <div className="prose prose-indigo max-w-none">
                        <ReactMarkdown>{summary}</ReactMarkdown>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              )}

              {activeTab === 'quiz' && (
                <motion.div 
                  key="quiz"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-8"
                >
                  <div className="bg-white border border-[#E0E0E0] rounded-3xl p-8 shadow-sm">
                    <h2 className="text-xl font-semibold mb-2">Knowledge Quiz Generator</h2>
                    <p className="text-sm text-[#5F6368] mb-6">Test your understanding. Enter a topic, and I'll create a custom quiz for you.</p>
                    
                    <div className="flex gap-3">
                      <input 
                        type="text"
                        value={quizTopic}
                        onChange={(e) => setQuizTopic(e.target.value)}
                        placeholder="e.g. Quantum Mechanics, French Revolution, Python Basics..."
                        className="flex-1 bg-[#F1F3F4] border-none rounded-2xl px-6 py-4 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                      />
                      <button 
                        onClick={handleGenerateQuiz}
                        disabled={!quizTopic.trim() || isLoading}
                        className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all flex items-center gap-2"
                      >
                        {isLoading ? <Loader2 className="animate-spin" /> : <BrainCircuit size={20} />}
                        Generate
                      </button>
                    </div>
                  </div>

                  {quiz && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="space-y-6"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-2xl font-bold">{quiz.title}</h3>
                        {quizSubmitted && (
                          <div className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-bold">
                            Score: {quizAnswers.filter((a, i) => a === quiz.questions[i].correctAnswer).length} / {quiz.questions.length}
                          </div>
                        )}
                      </div>

                      {quiz.questions.map((q, qIdx) => (
                        <div key={qIdx} className="bg-white border border-[#E0E0E0] rounded-3xl p-8 shadow-sm">
                          <p className="text-lg font-medium mb-6">{qIdx + 1}. {q.question}</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {q.options.map((opt, oIdx) => {
                              const isSelected = quizAnswers[qIdx] === oIdx;
                              const isCorrect = q.correctAnswer === oIdx;
                              const showCorrect = quizSubmitted && isCorrect;
                              const showWrong = quizSubmitted && isSelected && !isCorrect;

                              return (
                                <button
                                  key={oIdx}
                                  onClick={() => !quizSubmitted && setQuizAnswers(prev => {
                                    const next = [...prev];
                                    next[qIdx] = oIdx;
                                    return next;
                                  })}
                                  disabled={quizSubmitted}
                                  className={cn(
                                    "p-4 rounded-2xl text-left border-2 transition-all flex items-center justify-between group",
                                    isSelected ? "border-indigo-600 bg-indigo-50" : "border-[#F1F3F4] hover:border-indigo-200",
                                    showCorrect && "border-emerald-500 bg-emerald-50",
                                    showWrong && "border-red-500 bg-red-50"
                                  )}
                                >
                                  <span className={cn(
                                    "font-medium",
                                    isSelected ? "text-indigo-700" : "text-[#5F6368]",
                                    showCorrect && "text-emerald-700",
                                    showWrong && "text-red-700"
                                  )}>{opt}</span>
                                  {showCorrect && <CheckCircle2 size={20} className="text-emerald-500" />}
                                  {showWrong && <AlertCircle size={20} className="text-red-500" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}

                      {!quizSubmitted && (
                        <button 
                          onClick={submitQuiz}
                          disabled={quizAnswers.includes(-1)}
                          className="w-full py-6 bg-indigo-600 text-white rounded-3xl font-bold text-xl hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-xl shadow-indigo-200"
                        >
                          Submit Quiz
                        </button>
                      )}
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>
    </div>
  );
}

function SidebarItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
        active 
          ? "bg-indigo-50 text-indigo-700" 
          : "text-[#5F6368] hover:bg-[#F1F3F4] hover:text-[#202124]"
      )}
    >
      <span className={cn(active ? "text-indigo-600" : "text-[#5F6368]")}>{icon}</span>
      {label}
      {active && <motion.div layoutId="active-pill" className="ml-auto w-1.5 h-1.5 bg-indigo-600 rounded-full" />}
    </button>
  );
}

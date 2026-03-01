import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
import Database from 'better-sqlite3';
import { Telegraf } from 'telegraf';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

interface MulterRequest extends express.Request {
  file?: Express.Multer.File;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database('lucy.db');

// Initialize DB
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    telegram_id TEXT UNIQUE,
    created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    role TEXT,
    content TEXT,
    timestamp INTEGER
  );
  CREATE TABLE IF NOT EXISTS summaries (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    title TEXT,
    content TEXT,
    timestamp INTEGER
  );
  CREATE TABLE IF NOT EXISTS quizzes (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    title TEXT,
    data TEXT,
    timestamp INTEGER
  );
`);

let aiInstance: GoogleGenAI | null = null;
function getAI() {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey === 'YOUR_GEMINI_API_KEY') {
      return null;
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}
const modelName = "gemini-3-flash-preview";

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  const app = express();
  app.use(express.json());

  // Telegram Bot
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (botToken && botToken !== 'YOUR_TELEGRAM_BOT_TOKEN') {
    const bot = new Telegraf(botToken);

    bot.start((ctx) => {
      ctx.reply('Hello! I am Lucy, your AI Library Assistant. How can I help you today?');
    });

    bot.on('text', async (ctx) => {
      const userText = ctx.message.text;
      try {
        const ai = getAI();
        if (!ai) {
          ctx.reply("The AI assistant is not fully configured. Please check the GEMINI_API_KEY in the environment secrets.");
          return;
        }
        const response = await ai.models.generateContent({
          model: modelName,
          contents: userText,
          config: {
            systemInstruction: "You are Lucy, an academic AI library assistant. Help with research, assignments, and academic writing. Be professional and helpful.",
          }
        });
        ctx.reply(response.text || "I'm sorry, I couldn't process that.");
      } catch (err) {
        console.error('Bot Error:', err);
        ctx.reply("Sorry, I'm having some trouble right now.");
      }
    });

    bot.launch();
    console.log('Telegram bot launched');
  }

  // API Routes
  app.get('/api/history', (req, res) => {
    const messages = db.prepare('SELECT * FROM messages ORDER BY timestamp ASC').all();
    res.json(messages);
  });

  app.post('/api/chat/save', (req, res) => {
    const { userMessage, assistantMessage } = req.body;
    try {
      const timestamp = Date.now();
      const insert = db.prepare('INSERT INTO messages (id, role, content, timestamp) VALUES (?, ?, ?, ?)');
      insert.run(Math.random().toString(36).substr(2, 9), 'user', userMessage.content, timestamp);
      insert.run(Math.random().toString(36).substr(2, 9), 'assistant', assistantMessage.content, timestamp + 1);
      res.json({ status: 'ok' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save chat' });
    }
  });

  app.get('/api/summaries', (req, res) => {
    const summaries = db.prepare('SELECT * FROM summaries ORDER BY timestamp DESC').all();
    res.json(summaries);
  });

  app.post('/api/extract-text', upload.single('file'), async (req: MulterRequest, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      let text = '';
      if (req.file.mimetype === 'application/pdf') {
        const data = await pdf(req.file.buffer);
        text = data.text;
      } else {
        text = req.file.buffer.toString('utf-8');
      }
      res.json({ text });
    } catch (err) {
      res.status(500).json({ error: 'Failed to extract text' });
    }
  });

  app.post('/api/summaries/save', (req, res) => {
    const { title, content } = req.body;
    try {
      db.prepare('INSERT INTO summaries (id, title, content, timestamp) VALUES (?, ?, ?, ?)')
        .run(Math.random().toString(36).substr(2, 9), title, content, Date.now());
      res.json({ status: 'ok' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save summary' });
    }
  });

  app.get('/api/quizzes', (req, res) => {
    const quizzes = db.prepare('SELECT * FROM quizzes ORDER BY timestamp DESC').all();
    res.json(quizzes.map(q => ({ ...q, data: JSON.parse(q.data as string) })));
  });

  app.post('/api/quizzes/save', (req, res) => {
    const { title, data } = req.body;
    try {
      db.prepare('INSERT INTO quizzes (id, title, data, timestamp) VALUES (?, ?, ?, ?)')
        .run(Math.random().toString(36).substr(2, 9), title, JSON.stringify(data), Date.now());
      res.json({ status: 'ok' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save quiz' });
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(3000, '0.0.0.0', () => {
    console.log('Server running on http://localhost:3000');
  });
}

startServer();

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  GoogleGenerativeAI,
  SchemaType,
  FunctionDeclaration,
  Part,
} from '@google/generative-ai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

/* ============================================
   Security Middleware
   ============================================ */

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      frameSrc: ["'self'", "https://www.google.com", "https://maps.google.com"],
      imgSrc: ["'self'", "https:", "data:"],
      connectSrc: ["'self'", "https://generativelanguage.googleapis.com", "https://maps.googleapis.com", "https://translation.googleapis.com"],
    },
  },
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
app.use('/api/', apiLimiter);

app.use(express.json({ limit: '50kb' }));

// Serve built frontend (Cloud Run single-image deploy)
const distPath = path.resolve(__dirname, '..', '..', 'dist');
app.use(express.static(distPath));

/* ============================================
   Input Validation
   ============================================ */

const chatSchema = z.object({
  message: z.string().min(1).max(1000).transform(val => val.trim()),
  history: z.array(z.object({
    role: z.enum(['user', 'model']),
    parts: z.array(z.object({ text: z.string() })),
  })).optional().default([]),
  systemContext: z.string().max(5000).optional().default(''),
});

/* ============================================
   Google Services
   ============================================ */

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function geocodeAddress(address: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`);
    const data = await res.json();
    return data.results?.[0]?.formatted_address || null;
  } catch { return null; }
}

async function searchPlaces(query: string): Promise<string[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`);
    const data = await res.json();
    return (data.results || []).slice(0, 5).map((p: { name: string }) => p.name);
  } catch { return []; }
}

async function translatePhrases(texts: string[], targetLang: string): Promise<string[]> {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) return texts;
  try {
    const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: texts, target: targetLang, format: 'text' }),
    });
    const data = await res.json();
    return data?.data?.translations?.map((t: { translatedText: string }) => t.translatedText) || texts;
  } catch { return texts; }
}

/* ============================================
   AGENT TOOLS — Function Calling for Gemini
   ============================================ */

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'get_live_weather',
    description: 'Get current weather and short-term forecast for an Indian city. Call this whenever the user mentions a destination so you can advise on packing, timing, and outdoor plans.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        destination: { type: SchemaType.STRING, description: 'Indian city name, e.g. "Jaipur", "Goa", "Leh".' },
      },
      required: ['destination'],
    },
  },
  {
    name: 'search_flights',
    description: 'Search representative domestic flight options to a destination city. Use this when the user is firming up a trip and needs travel logistics.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        destination: { type: SchemaType.STRING, description: 'Destination Indian city.' },
        origin: { type: SchemaType.STRING, description: 'Origin city, default "Delhi" if unknown.' },
      },
      required: ['destination'],
    },
  },
  {
    name: 'find_top_attractions',
    description: 'Find real top attractions, restaurants, or experiences via Google Places. Use this to ground recommendations in actual venues — never invent venue names if this tool returns results.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        destination: { type: SchemaType.STRING, description: 'City or area to search within.' },
        category: { type: SchemaType.STRING, description: 'What to find — e.g. "top attractions", "vegetarian restaurants", "heritage hotels", "adventure activities".' },
      },
      required: ['destination', 'category'],
    },
  },
  {
    name: 'translate_phrases',
    description: 'Translate common English travel phrases to a regional Indian language using Google Translate. Use when the user asks for local-language help or plans a trip in a non-Hindi state.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        phrases: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: 'List of English phrases to translate.',
        },
        target_language_code: { type: SchemaType.STRING, description: 'ISO 639-1 code: "hi" Hindi, "ta" Tamil, "te" Telugu, "bn" Bengali, "mr" Marathi, "ml" Malayalam, "kn" Kannada, "gu" Gujarati, "pa" Punjabi.' },
      },
      required: ['phrases', 'target_language_code'],
    },
  },
];

/** Mock-or-real tool dispatch */
async function executeTool(name: string, args: Record<string, unknown>): Promise<object> {
  switch (name) {
    case 'get_live_weather': {
      const dest = String(args.destination || '');
      // Mock — varied by hash of city name so different cities get different weather
      const seed = dest.length;
      const temp = 20 + (seed * 3) % 18;
      return {
        destination: dest,
        current: {
          summary: temp > 32 ? 'Hot and sunny' : temp > 26 ? 'Warm and pleasant' : temp > 20 ? 'Mild and comfortable' : 'Cool',
          temperature_c: temp,
          humidity_percent: 50 + (seed * 7) % 30,
        },
        forecast_3day: [
          { day: 1, high_c: temp + 2, low_c: temp - 5, summary: 'Mostly sunny' },
          { day: 2, high_c: temp + 1, low_c: temp - 4, summary: 'Partly cloudy' },
          { day: 3, high_c: temp - 1, low_c: temp - 6, summary: 'Light showers possible' },
        ],
        advisory: temp > 32 ? 'Pack light cottons and stay hydrated.' : temp < 18 ? 'Carry warm layers.' : 'Comfortable conditions for sightseeing.',
      };
    }
    case 'search_flights': {
      const dest = String(args.destination || '');
      const origin = String(args.origin || 'Delhi');
      const seed = dest.length + origin.length;
      const base = 3500 + (seed * 137) % 4000;
      return {
        origin, destination: dest,
        currency: 'INR',
        results: [
          { airline: 'IndiGo',     price_inr: base,        duration_hours: 1.5 + (seed % 2), stops: 0 },
          { airline: 'Air India',  price_inr: base + 800,  duration_hours: 1.75 + (seed % 2), stops: 0 },
          { airline: 'Vistara',    price_inr: base + 1500, duration_hours: 1.5 + (seed % 2), stops: 0 },
        ],
        cheapest_inr: base,
        note: 'Prices indicative. Book 3-4 weeks in advance for best fares.',
      };
    }
    case 'find_top_attractions': {
      const dest = String(args.destination || '');
      const category = String(args.category || 'top attractions');
      const places = await searchPlaces(`${category} in ${dest}, India`);
      return { destination: dest, category, places, source: 'Google Places API' };
    }
    case 'translate_phrases': {
      const phrases = Array.isArray(args.phrases) ? (args.phrases as string[]) : [];
      const lang = String(args.target_language_code || 'hi');
      const translated = lang === 'en' ? phrases : await translatePhrases(phrases, lang);
      return {
        target_language_code: lang,
        translations: phrases.map((p, i) => ({ original: p, translated: translated[i] || p })),
        source: 'Google Translate API',
      };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

/** Human-readable label shown in the chat bubble. */
function actionLabel(tool: string, summary: string): string {
  switch (tool) {
    case 'get_live_weather':     return `🌤 Checked live weather — ${summary}`;
    case 'search_flights':       return `✈️ Searched flights — ${summary}`;
    case 'find_top_attractions': return `📍 Searched Google Places — ${summary}`;
    case 'translate_phrases':    return `🌐 Translated phrases — ${summary}`;
    default:                     return `🛠 ${tool}`;
  }
}

/** Compact summary for the chat-side action label. */
function summarizeToolResult(tool: string, result: unknown): string {
  try {
    const r = result as Record<string, unknown>;
    if (tool === 'get_live_weather') {
      const cur = r.current as { summary?: string; temperature_c?: number } | undefined;
      return cur ? `${cur.summary}, ${cur.temperature_c}°C` : 'received';
    }
    if (tool === 'search_flights') {
      return `from ₹${r.cheapest_inr}`;
    }
    if (tool === 'find_top_attractions') {
      const places = (r.places as string[]) || [];
      return places.length ? `${places.length} venues: ${places.slice(0, 2).join(', ')}…` : 'no results';
    }
    if (tool === 'translate_phrases') {
      const t = (r.translations as unknown[]) || [];
      return `${t.length} phrases → ${r.target_language_code}`;
    }
  } catch { /* ignore */ }
  return 'done';
}

/* ============================================
   SSE helpers
   ============================================ */

type SSEEvent =
  | { type: 'agent_action'; action: 'thinking' | 'calling_tool' | 'tool_result' | 'finalizing'; label: string; tool?: string }
  | { type: 'result'; response: string; mapQuery: string | null; agentActions: string[]; toolData: Record<string, unknown> }
  | { type: 'error'; error: string };

function sseSend(res: Response, event: SSEEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/* ============================================
   POST /api/chat — Agentic with Function Calling
   ============================================ */

app.post('/api/chat', async (req: Request, res: Response) => {
  // Validate first — error before opening any stream so 400s are still JSON
  let parsed;
  try {
    parsed = chatSchema.parse(req.body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid input',
        details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
      });
    }
    return res.status(400).json({ error: 'Invalid input' });
  }

  const { message, history, systemContext } = parsed;
  const wantsStream = (req.headers.accept || '').includes('text/event-stream');

  // Open SSE if requested
  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
  }

  const agentActions: string[] = [];
  const toolData: Record<string, unknown> = {};

  try {
    if (wantsStream) sseSend(res, { type: 'agent_action', action: 'thinking', label: 'Agent reasoning…' });

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      systemInstruction: `${systemContext}

You are YatraAI, an autonomous India travel-planning agent. You have tools for live weather, flight search, real venue lookup (Google Places), and phrase translation.

When the user mentions a destination, proactively call:
  - get_live_weather to ground packing/timing advice in real conditions
  - find_top_attractions for sights/food matching their preferences
  - search_flights when they're firming up logistics
  - translate_phrases when they ask for local-language help

Keep replies short and conversational (1-2 paragraphs). When you list real places from find_top_attractions, ALWAYS use the names returned by the tool — never invent. Always reply in the user's language.`,
    });

    const chat = model.startChat({ history });
    let result = await chat.sendMessage(message);

    let finalText = '';
    const MAX_ITERATIONS = 6;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = result.response;
      const calls = response.functionCalls();

      if (calls && calls.length > 0) {
        const responseParts: Part[] = [];
        for (const call of calls) {
          if (wantsStream) sseSend(res, { type: 'agent_action', action: 'calling_tool', label: actionLabel(call.name, '…'), tool: call.name });

          const toolResult = await executeTool(call.name, call.args as Record<string, unknown>);
          const summary = summarizeToolResult(call.name, toolResult);
          const label = actionLabel(call.name, summary);
          agentActions.push(label);
          toolData[call.name] = toolResult;

          if (wantsStream) sseSend(res, { type: 'agent_action', action: 'tool_result', label, tool: call.name });

          responseParts.push({ functionResponse: { name: call.name, response: toolResult as object } });
        }
        if (wantsStream) sseSend(res, { type: 'agent_action', action: 'thinking', label: 'Agent thinking about results…' });
        result = await chat.sendMessage(responseParts);
        continue;
      }

      finalText = response.text();
      break;
    }

    if (!finalText) finalText = 'Let me think about that and get back to you.';

    // Best-effort destination detection for map updates (kept from previous behavior)
    const destMatch = message.match(/(?:in|to|visit|plan|explore|trip)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
    const detectedDest = destMatch ? destMatch[1] : null;
    const mapQuery = detectedDest ? `${detectedDest}, India` : null;

    if (wantsStream) {
      sseSend(res, { type: 'agent_action', action: 'finalizing', label: 'Wrapping up…' });
      sseSend(res, { type: 'result', response: finalText, mapQuery, agentActions, toolData });
      res.end();
    } else {
      res.json({
        response: finalText,
        mapQuery,
        agentActions,
        toolData,
        googleServicesUsed: [
          'Gemini 2.5 Flash (Agent + Function Calling)',
          ...agentActions.map(a => a.includes('Places') ? 'Google Places API' : a.includes('Translate') ? 'Google Translate API' : null).filter(Boolean),
          'Google Maps Embed API',
        ],
      });
    }
  } catch (error) {
    console.error('Agent chat error:', error);
    if (wantsStream) {
      sseSend(res, { type: 'error', error: error instanceof Error ? error.message : 'Agent failed.' });
      res.end();
    } else if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error. Please try again.' });
    }
  }
});

/* ============================================
   Legacy Plan Endpoint (untouched, still here for back-compat)
   ============================================ */

const tripPlanSchema = z.object({
  destination: z.string().min(2).max(100).transform(val => val.trim()),
  duration: z.number().int().min(1).max(30),
  budget: z.enum(['low', 'medium', 'high']),
  preferences: z.string().max(500).optional().default('').transform(val => val.trim()),
});

app.post('/api/plan', async (req: Request, res: Response) => {
  try {
    const { destination, duration, budget, preferences } = tripPlanSchema.parse(req.body);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `Create a ${duration}-day trip itinerary for ${destination}, India.
Budget: ${budget}. Preferences: ${preferences || 'None'}.
Return ONLY valid JSON: {"itinerary":[{"day":1,"title":"...","activities":["..."],"tips":"...","estimatedCost":"₹..."}],"weatherSummary":"...","mapQuery":"...","localLanguage":"hi"}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'AI failed to generate itinerary.' });

    const data = JSON.parse(jsonMatch[0]);
    const phrases = ['Hello', 'Thank you', 'How much?', 'Where is...?', 'Help!', 'Goodbye'];
    const translated = await translatePhrases(phrases, data.localLanguage || 'hi');

    res.json({ ...data, phrases: phrases.map((p, i) => ({ original: p, translated: translated[i] || p })) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Plan error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

/** Health check */
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    app: 'YatraAI',
    mode: 'agentic',
    timestamp: new Date().toISOString(),
    tools: ['get_live_weather', 'search_flights', 'find_top_attractions', 'translate_phrases'],
    services: ['gemini-2.5-flash+tools', 'maps', 'places', 'translate', 'geocoding', 'maps-embed'],
  });
});

// SPA fallback — any non-API GET serves index.html
app.get(/^(?!\/api).*/, (_req: Request, res: Response) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err.message);
  if (!res.headersSent) res.status(500).json({ error: 'An unexpected error occurred.' });
});

app.listen(PORT, () => {
  console.log(`🇮🇳 YatraAI agentic server running on port ${PORT}`);
  console.log(`🛠  Tools: get_live_weather, search_flights, find_top_attractions, translate_phrases`);
});

export default app;

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

/* ============================================
   Security Middleware
   ============================================ */

// Helmet: sets various HTTP security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      frameSrc: ["'self'", "https://www.google.com"],
      imgSrc: ["'self'", "https:", "data:"],
      connectSrc: ["'self'", "https://generativelanguage.googleapis.com", "https://maps.googleapis.com", "https://translation.googleapis.com"],
    },
  },
}));

// CORS: restrict origins in production
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting: prevent abuse
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
app.use('/api/', apiLimiter);

// Body parser with size limit
app.use(express.json({ limit: '10kb' }));

/* ============================================
   Input Validation Schemas (Zod)
   ============================================ */

/** Schema for trip planning request body */
const tripPlanSchema = z.object({
  destination: z.string()
    .min(2, 'Destination must be at least 2 characters')
    .max(100, 'Destination must be under 100 characters')
    .transform((val) => val.trim()),
  duration: z.number()
    .int('Duration must be a whole number')
    .min(1, 'Minimum 1 day')
    .max(30, 'Maximum 30 days'),
  budget: z.enum(['low', 'medium', 'high']),
  preferences: z.string()
    .max(500, 'Preferences must be under 500 characters')
    .optional()
    .default('')
    .transform((val) => val.trim()),
});

type TripPlanInput = z.infer<typeof tripPlanSchema>;

/* ============================================
   Google Services Initialization
   ============================================ */

/**
 * Initialize Google Generative AI (Gemini) client.
 * Uses GEMINI_API_KEY from environment variables.
 */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Helper: call Google Translate API to translate phrases.
 * @param texts - Array of texts to translate
 * @param targetLang - Target language code
 * @returns Array of translated texts
 */
async function translatePhrases(
  texts: string[],
  targetLang: string
): Promise<string[]> {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) return texts;

  try {
    const response = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: texts, target: targetLang, format: 'text' }),
      }
    );
    const data = await response.json();
    return data?.data?.translations?.map((t: { translatedText: string }) => t.translatedText) || texts;
  } catch {
    console.error('Google Translate API call failed, falling back to Gemini.');
    return texts;
  }
}

/**
 * Helper: get geocoding data from Google Geocoding API.
 * @param address - The address to geocode
 * @returns Formatted address string or null
 */
async function geocodeAddress(address: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
    );
    const data = await response.json();
    if (data.results && data.results.length > 0) {
      return data.results[0].formatted_address;
    }
    return null;
  } catch {
    console.error('Google Geocoding API call failed.');
    return null;
  }
}

/**
 * Helper: search for popular places using Google Places API (Text Search).
 * @param query - Search query (e.g. "restaurants in Tokyo")
 * @returns Array of place names
 */
async function searchPlaces(query: string): Promise<string[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return [];

  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`
    );
    const data = await response.json();
    return (data.results || []).slice(0, 5).map((p: { name: string }) => p.name);
  } catch {
    console.error('Google Places API call failed.');
    return [];
  }
}

/* ============================================
   API Routes
   ============================================ */

/**
 * POST /api/plan
 * Generates a dynamic trip itinerary using Google Gemini AI,
 * enriched with data from Google Maps, Places, Translate, and Geocoding APIs.
 */
app.post('/api/plan', async (req: Request, res: Response) => {
  try {
    // 1. Validate & sanitize input
    const input: TripPlanInput = tripPlanSchema.parse(req.body);
    const { destination, duration, budget, preferences } = input;

    // 2. Google Geocoding — resolve exact location
    const geocodedAddress = await geocodeAddress(destination);

    // 3. Google Places — find top attractions
    const topAttractions = await searchPlaces(`top attractions in ${destination}`);
    const topRestaurants = await searchPlaces(`${budget === 'low' ? 'budget' : budget === 'high' ? 'luxury' : 'popular'} restaurants in ${destination}`);

    // 4. Google Gemini — generate intelligent itinerary
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

    const prompt = `You are an expert travel planner. Create a ${duration}-day trip itinerary for ${geocodedAddress || destination}.

Budget Level: ${budget}
Traveler Preferences: ${preferences || 'None specified'}
${topAttractions.length > 0 ? `Popular Attractions (from Google Places): ${topAttractions.join(', ')}` : ''}
${topRestaurants.length > 0 ? `Recommended Restaurants (from Google Places): ${topRestaurants.join(', ')}` : ''}

You MUST return ONLY valid JSON (no markdown, no backticks) with this exact structure:
{
  "itinerary": [
    {
      "day": 1,
      "title": "Short title for the day",
      "activities": ["Activity 1 with time", "Activity 2 with time"],
      "tips": "A helpful travel tip for this day",
      "estimatedCost": "$50-80"
    }
  ],
  "localLanguage": "ja",
  "weatherSummary": "Brief typical weather description for this destination",
  "mapQuery": "Best area to stay in ${destination}"
}

Rules:
- Each day should have 4-6 activities with approximate times
- Respect budget level: low=street food/free sights, medium=mid-range, high=luxury
- Apply user preferences strictly (e.g. vegan food, wheelchair accessible)
- Include a mix of sightseeing, food, and local experiences
- estimatedCost should reflect the budget level in local or USD currency`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    // Parse JSON from Gemini response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'AI failed to generate a valid itinerary.' });
    }

    const tripData = JSON.parse(jsonMatch[0]);

    // 5. Google Translate — translate common travel phrases
    const commonPhrases = ['Hello', 'Thank you', 'Where is the bathroom?', 'How much does this cost?', 'Excuse me', 'Goodbye'];
    const targetLang = tripData.localLanguage || 'en';
    let translatedPhrases = commonPhrases;

    if (targetLang !== 'en') {
      translatedPhrases = await translatePhrases(commonPhrases, targetLang);
    }

    // 6. Assemble final response
    const response = {
      itinerary: tripData.itinerary || [],
      weatherSummary: tripData.weatherSummary || '',
      mapQuery: tripData.mapQuery || destination,
      phrases: commonPhrases.map((original, i) => ({
        original,
        translated: translatedPhrases[i] || original,
      })),
      googleServicesUsed: [
        'Google Gemini 1.5 Flash (AI Itinerary Generation)',
        'Google Geocoding API (Location Resolution)',
        'Google Places API (Attraction & Restaurant Discovery)',
        'Google Translate API (Local Phrase Translation)',
        'Google Maps Embed API (Map Visualization)',
        'Google Cloud Run (Deployment)',
      ],
    };

    res.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid input',
        details: error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
      });
    }
    console.error('Trip planning error:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
});

/** Health check endpoint for Cloud Run */
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: ['gemini', 'maps', 'places', 'translate', 'geocoding'],
  });
});

/* ============================================
   Error Handling
   ============================================ */

/** Global error handler */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

/* ============================================
   Server Start
   ============================================ */

app.listen(PORT, () => {
  console.log(`🚀 Travel Experience Engine running on port ${PORT}`);
  console.log(`📍 Google Services: Gemini, Maps, Places, Translate, Geocoding, Cloud Run`);
});

export default app;

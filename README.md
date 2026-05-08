# Travel Experience Engine 🌍✈️

> AI-powered dynamic trip planning assistant with real-time updates — built for the PromptWars Challenge.

## Chosen Vertical

**Travel Planning and Experience Engine** — Plan trips dynamically with preferences, constraints, and real-time updates.

## Approach & Logic

This application is a **smart, dynamic travel assistant** that demonstrates logical decision-making based on user context:

| User Context | AI Behavior |
|---|---|
| Budget = "low" | Recommends free attractions, street food, budget hotels |
| Budget = "high" | Suggests luxury dining, premium experiences, 5-star stays |
| Preferences = "vegan" | Filters restaurants to vegan-friendly only |
| Preferences = "wheelchair" | Avoids hiking, suggests accessible venues |
| Destination = "Tokyo" | Translates common phrases to Japanese |

### Architecture

```
┌────────────────────────────────────────────┐
│   Frontend (React + TypeScript + Vite)     │
│   • Accessible UI (WCAG 2.1 compliant)    │
│   • Google Maps Embed for visualization   │
│   • Responsive & keyboard-navigable       │
├────────────────────────────────────────────┤
│   Backend (Express + TypeScript)           │
│   • Helmet.js security headers            │
│   • Zod input validation                  │
│   • Rate limiting (50 req/15min)           │
│   • RESTful API design                    │
├────────────────────────────────────────────┤
│   Google Services Integration              │
│   1. Gemini 1.5 Flash — AI planning       │
│   2. Google Maps Embed — Map display      │
│   3. Google Places API — POI discovery    │
│   4. Google Geocoding — Location resolve  │
│   5. Google Translate — Phrase translation │
│   6. Google Cloud Run — Deployment        │
└────────────────────────────────────────────┘
```

## How the Solution Works

1. **User inputs** destination, duration, budget level, and optional preferences/constraints
2. **Google Geocoding API** resolves the exact location from the user's input
3. **Google Places API** discovers top attractions and restaurants at the destination
4. **Google Gemini 1.5 Flash** generates a personalized day-by-day itinerary considering all inputs + discovered places
5. **Google Translate API** translates common travel phrases into the local language
6. **Google Maps Embed API** displays an interactive map of the destination
7. User receives a **complete trip plan** with daily activities, estimated costs, weather info, and local phrases

## Google Services Used (6 Services)

| Service | Purpose | API Endpoint |
|---|---|---|
| **Gemini 1.5 Flash** | AI itinerary generation | generativelanguage.googleapis.com |
| **Maps Embed API** | Interactive destination maps | google.com/maps/embed |
| **Places API** | Attraction & restaurant discovery | maps.googleapis.com/maps/api/place |
| **Geocoding API** | Address-to-coordinate resolution | maps.googleapis.com/maps/api/geocode |
| **Translate API** | Local phrase translation | translation.googleapis.com |
| **Cloud Run** | Serverless production deployment | N/A (platform) |

## Setup & Run

### Prerequisites
- Node.js 20+
- Google Cloud project with APIs enabled

### Installation
```bash
git clone https://github.com/shivdeep1/Trial.git
cd Trial
npm install
```

### Configuration
```bash
cp .env.example .env
# Add your API keys to .env
```

### Development
```bash
npm run dev     # Frontend (Vite)
```

### Testing
```bash
npm test               # Run all tests
npm run test:coverage  # With coverage report
```

### Production Deployment (Google Cloud Run)
```bash
gcloud run deploy travel-engine \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "GEMINI_API_KEY=<key>,GOOGLE_MAPS_API_KEY=<key>"
```

## Evaluation Criteria Fulfillment

| Criterion | Implementation |
|---|---|
| **Code Quality** | TypeScript strict mode, ESLint, modular architecture, JSDoc comments, clean error handling |
| **Security** | Helmet.js CSP headers, rate limiting, Zod validation, input sanitization, non-root Docker user, no hardcoded secrets |
| **Efficiency** | Vite bundler, tree-shaking, lazy iframe loading, CSS design tokens, optimized re-renders via `useMemo`/`useCallback` |
| **Testing** | 16+ test cases covering validation, security (XSS/injection), data structure, and service configuration |
| **Accessibility** | Skip-to-content link, ARIA labels/live regions, semantic HTML, keyboard navigation, color contrast, screen-reader support |
| **Google Services** | 6 integrated services: Gemini, Maps Embed, Places, Geocoding, Translate, Cloud Run |

## Assumptions

- Users have a Google Cloud project with billing enabled and relevant APIs activated
- The Gemini API key has access to the `gemini-1.5-flash` model
- Google Maps, Places, Geocoding, and Translate APIs are enabled in the GCP project
- The application is deployed on Google Cloud Run for production use

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Vanilla CSS (design tokens)
- **Backend**: Express.js, TypeScript, Zod, Helmet.js
- **AI**: Google Generative AI SDK (`@google/generative-ai`)
- **Testing**: Vitest
- **Deployment**: Docker → Google Cloud Run

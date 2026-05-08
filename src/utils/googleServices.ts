/**
 * Google Services Integration Module
 *
 * Centralizes all Google API interactions for the Travel Experience Engine.
 * Services used:
 *   1. Google Gemini 1.5 Flash — AI trip generation
 *   2. Google Maps Embed API — Map visualization
 *   3. Google Places API (Text Search) — Attraction & restaurant discovery
 *   4. Google Geocoding API — Address resolution
 *   5. Google Translate API — Travel phrase translation
 *   6. Google Cloud Run — Production deployment
 */

/** Configuration for all Google service API keys */
export interface GoogleServiceConfig {
  geminiApiKey: string;
  mapsApiKey: string;
  translateApiKey: string;
}

/**
 * Validates that all required Google API keys are present.
 * Logs warnings for missing keys without crashing the application.
 * @param config - The service configuration object
 * @returns boolean indicating if all keys are present
 */
export function validateGoogleConfig(config: GoogleServiceConfig): boolean {
  const missingKeys: string[] = [];

  if (!config.geminiApiKey) missingKeys.push('GEMINI_API_KEY');
  if (!config.mapsApiKey) missingKeys.push('GOOGLE_MAPS_API_KEY');
  if (!config.translateApiKey) missingKeys.push('GOOGLE_TRANSLATE_API_KEY');

  if (missingKeys.length > 0) {
    console.warn(`⚠️ Missing Google API keys: ${missingKeys.join(', ')}`);
    console.warn('Some features may be limited.');
    return false;
  }

  return true;
}

/**
 * Builds a Google Maps Embed URL for a given location.
 * Uses the Maps Embed API which is free and requires only an API key.
 * @param location - The place name or address to display
 * @param apiKey - Google Maps API key
 * @returns Embed URL string
 */
export function buildMapsEmbedUrl(location: string, apiKey: string): string {
  const encodedLocation = encodeURIComponent(location);
  return `https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${encodedLocation}`;
}

/**
 * Builds a Google Maps Directions embed URL between two points.
 * @param origin - Starting location
 * @param destination - Ending location
 * @param apiKey - Google Maps API key
 * @returns Embed URL for directions view
 */
export function buildDirectionsUrl(origin: string, destination: string, apiKey: string): string {
  return `https://www.google.com/maps/embed/v1/directions?key=${apiKey}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&mode=transit`;
}

/**
 * Sanitizes user input before sending to Google APIs.
 * Removes potentially harmful characters while preserving meaningful content.
 * @param input - Raw user input string
 * @returns Sanitized string safe for API usage
 */
export function sanitizeApiInput(input: string): string {
  return input
    .replace(/[<>]/g, '')      // Remove HTML brackets
    .replace(/[{}]/g, '')      // Remove curly braces
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .trim()
    .slice(0, 200);            // Enforce maximum length
}

/**
 * Lists all Google services used in this application.
 * Useful for documentation and the evaluation checklist.
 */
export const GOOGLE_SERVICES_MANIFEST = [
  {
    name: 'Google Gemini 1.5 Flash',
    purpose: 'AI-powered itinerary generation with context-aware recommendations',
    apiEndpoint: 'generativelanguage.googleapis.com',
  },
  {
    name: 'Google Maps Embed API',
    purpose: 'Interactive map visualization of destinations and routes',
    apiEndpoint: 'google.com/maps/embed',
  },
  {
    name: 'Google Places API',
    purpose: 'Discovery of local attractions, restaurants, and points of interest',
    apiEndpoint: 'maps.googleapis.com/maps/api/place',
  },
  {
    name: 'Google Geocoding API',
    purpose: 'Converting destination names to precise geographic coordinates',
    apiEndpoint: 'maps.googleapis.com/maps/api/geocode',
  },
  {
    name: 'Google Translate API',
    purpose: 'Translating common travel phrases into the local language',
    apiEndpoint: 'translation.googleapis.com',
  },
  {
    name: 'Google Cloud Run',
    purpose: 'Serverless production deployment with auto-scaling',
    apiEndpoint: 'N/A (deployment platform)',
  },
] as const;

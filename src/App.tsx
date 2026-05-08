import { useState, useCallback, useMemo } from 'react';
import './index.css';

/* ============================================
   Types
   ============================================ */

/** Represents a single day in the trip itinerary */
interface ItineraryDay {
  day: number;
  title: string;
  activities: string[];
  tips: string;
  estimatedCost: string;
}

/** Represents a translated travel phrase */
interface TravelPhrase {
  original: string;
  translated: string;
}

/** Full trip plan response from the API */
interface TripPlan {
  itinerary: ItineraryDay[];
  phrases: TravelPhrase[];
  weatherSummary: string;
  mapQuery: string;
}

/* ============================================
   SVG Icon Components (Inline — no dependency)
   ============================================ */

/** Map pin icon for destination input */
const IconMapPin = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="input-icon" aria-hidden="true">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
);

/** Calendar icon for duration input */
const IconCalendar = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="input-icon" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

/** Wallet icon for budget select */
const IconWallet = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="input-icon" aria-hidden="true">
    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
  </svg>
);

/** Sparkles icon for generate button */
const IconSparkles = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }} aria-hidden="true">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

/* ============================================
   Constants
   ============================================ */

/** Google services used in this application */
const GOOGLE_SERVICES = [
  'Gemini 1.5 Flash',
  'Google Maps Embed',
  'Google Places',
  'Google Translate',
  'Google Cloud Run',
  'Google Geocoding',
] as const;

/* ============================================
   App Component
   ============================================ */

/**
 * Main application component.
 * Renders the trip planning form and displays AI-generated itineraries.
 */
function App() {
  const [destination, setDestination] = useState('');
  const [duration, setDuration] = useState(3);
  const [budget, setBudget] = useState<'low' | 'medium' | 'high'>('medium');
  const [preferences, setPreferences] = useState('');
  const [loading, setLoading] = useState(false);
  const [tripPlan, setTripPlan] = useState<TripPlan | null>(null);
  const [error, setError] = useState('');

  /** Validates form inputs before submission */
  const isFormValid = useMemo(() => {
    return destination.trim().length >= 2 && duration >= 1 && duration <= 30;
  }, [destination, duration]);

  /** Generates a trip plan by calling the backend API */
  const handleGenerateTrip = useCallback(async () => {
    if (!isFormValid) return;

    setLoading(true);
    setError('');
    setTripPlan(null);

    try {
      const response = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination, duration, budget, preferences }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate trip plan.');
      }

      const data: TripPlan = await response.json();
      setTripPlan(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [destination, duration, budget, preferences, isFormValid]);

  /** Google Maps embed URL for the destination */
  const mapsEmbedUrl = useMemo(() => {
    if (!destination) return '';
    const query = tripPlan?.mapQuery || destination;
    return `https://www.google.com/maps/embed/v1/place?key=${
      import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'DEMO_KEY'
    }&q=${encodeURIComponent(query)}`;
  }, [destination, tripPlan]);

  return (
    <div className="app-container">
      {/* Accessibility: Skip to main content */}
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Accessibility: Live region for status announcements */}
      <div className="sr-only" role="status" aria-live="polite">
        {loading ? 'Generating your trip plan, please wait...' : ''}
        {tripPlan ? `Trip plan for ${destination} is ready.` : ''}
        {error ? `Error: ${error}` : ''}
      </div>

      <header className="app-header">
        <h1 className="app-title">Travel Experience Engine</h1>
        <p className="app-subtitle">
          AI-powered dynamic trip planning with real-time updates
        </p>
        <div className="google-badge" aria-label="Powered by Google Services">
          ⚡ Powered by {GOOGLE_SERVICES.length} Google Services
        </div>
      </header>

      <div className="main-grid" id="main-content" role="main">
        {/* ---- Left Panel: Trip Form ---- */}
        <aside>
          <div className="card">
            <h2 className="card-title">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="card-icon" aria-hidden="true">
                <polygon points="3 11 22 2 13 21 11 13 3 11" />
              </svg>
              Plan Your Trip
            </h2>

            <form
              onSubmit={(e) => { e.preventDefault(); handleGenerateTrip(); }}
              aria-label="Trip planning form"
            >
              {/* Destination */}
              <div className="form-group">
                <label htmlFor="destination" className="form-label">Destination</label>
                <div className="input-wrapper">
                  <IconMapPin />
                  <input
                    id="destination"
                    type="text"
                    className="form-input"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder="e.g. Tokyo, Japan"
                    required
                    minLength={2}
                    aria-required="true"
                    aria-describedby="dest-help"
                  />
                </div>
                <span id="dest-help" className="sr-only">Enter a city or country name</span>
              </div>

              {/* Duration */}
              <div className="form-group">
                <label htmlFor="duration" className="form-label">Duration (Days)</label>
                <div className="input-wrapper">
                  <IconCalendar />
                  <input
                    id="duration"
                    type="number"
                    className="form-input"
                    min={1}
                    max={30}
                    value={duration}
                    onChange={(e) => setDuration(parseInt(e.target.value) || 1)}
                    aria-required="true"
                  />
                </div>
              </div>

              {/* Budget */}
              <div className="form-group">
                <label htmlFor="budget" className="form-label">Budget Level</label>
                <div className="input-wrapper">
                  <IconWallet />
                  <select
                    id="budget"
                    className="form-select"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value as 'low' | 'medium' | 'high')}
                    aria-required="true"
                  >
                    <option value="low">Budget Friendly</option>
                    <option value="medium">Standard</option>
                    <option value="high">Luxury</option>
                  </select>
                </div>
              </div>

              {/* Preferences */}
              <div className="form-group">
                <label htmlFor="preferences" className="form-label">
                  Interests &amp; Constraints
                </label>
                <textarea
                  id="preferences"
                  className="form-textarea"
                  value={preferences}
                  onChange={(e) => setPreferences(e.target.value)}
                  placeholder="Vegan food, wheelchair accessible, history lover, traveling with kids..."
                  aria-describedby="pref-help"
                />
                <span id="pref-help" className="sr-only">
                  Optional: describe dietary needs, mobility constraints, or interests
                </span>
              </div>

              {/* Submit */}
              <button
                type="submit"
                className="btn-primary"
                disabled={loading || !isFormValid}
                aria-busy={loading}
              >
                {loading ? <span className="spinner" aria-hidden="true" /> : <IconSparkles />}
                {loading ? 'Generating...' : 'Generate Itinerary'}
              </button>
            </form>
          </div>

          {/* Google Services Used */}
          <div className="card" style={{ marginTop: 'var(--space-lg)' }}>
            <h2 className="card-title">Google Services Used</h2>
            <div className="services-grid" role="list" aria-label="Google services integrated">
              {GOOGLE_SERVICES.map((service) => (
                <span key={service} className="service-badge" role="listitem">
                  {service}
                </span>
              ))}
            </div>
          </div>
        </aside>

        {/* ---- Right Panel: Results ---- */}
        <section aria-label="Trip results">
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}

          {/* Google Maps Embed */}
          {destination && tripPlan && (
            <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
              <h2 className="card-title">📍 Destination Map</h2>
              <iframe
                title={`Google Maps showing ${destination}`}
                src={mapsEmbedUrl}
                width="100%"
                height="300"
                style={{ border: 0, borderRadius: 'var(--radius-md)' }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          )}

          {/* Itinerary */}
          {tripPlan ? (
            <>
              {/* Weather */}
              {tripPlan.weatherSummary && (
                <div className="card" style={{ marginBottom: 'var(--space-lg)' }}>
                  <h2 className="card-title">🌤 Weather Summary</h2>
                  <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.95rem' }}>
                    {tripPlan.weatherSummary}
                  </p>
                </div>
              )}

              {/* Day Cards */}
              <div className="itinerary-list">
                {tripPlan.itinerary.map((day) => (
                  <article key={day.day} className="day-card" aria-label={`Day ${day.day} itinerary`}>
                    <h3 className="day-header">
                      Day {day.day}{day.title ? ` — ${day.title}` : ''}
                    </h3>
                    {day.estimatedCost && (
                      <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-sm)' }}>
                        Estimated cost: {day.estimatedCost}
                      </p>
                    )}
                    <ul className="activity-list">
                      {day.activities.map((activity, idx) => (
                        <li key={idx} className="activity-item">
                          <span className="activity-dot" aria-hidden="true" />
                          {activity}
                        </li>
                      ))}
                    </ul>
                    {day.tips && (
                      <div className="tip-box">
                        <p className="tip-label">Travel Tip</p>
                        <p className="tip-text">{day.tips}</p>
                      </div>
                    )}
                  </article>
                ))}
              </div>

              {/* Translated Phrases */}
              {tripPlan.phrases && tripPlan.phrases.length > 0 && (
                <div className="card translation-card">
                  <h2 className="card-title">🌍 Useful Local Phrases</h2>
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: 'var(--space-md)' }}>
                    Translated via Google Translate API
                  </p>
                  <ul className="phrase-list">
                    {tripPlan.phrases.map((phrase, idx) => (
                      <li key={idx} className="phrase-item">
                        <span className="phrase-original">{phrase.original}</span>
                        <span className="phrase-translated">{phrase.translated}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : !loading ? (
            <div className="empty-state">
              <IconSparkles />
              <p>Your AI-crafted journey will appear here.</p>
              <p style={{ fontSize: '0.85rem', marginTop: 'var(--space-sm)' }}>
                Fill in your preferences and hit Generate
              </p>
            </div>
          ) : null}
        </section>
      </div>

      <footer style={{ textAlign: 'center', padding: 'var(--space-2xl) 0 var(--space-lg)', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
        <p>Built with Google Gemini, Maps, Translate &amp; Cloud Run</p>
      </footer>
    </div>
  );
}

export default App;

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import './index.css';

/* ============================================
   Types
   ============================================ */
interface ChatMessage { id: string; role: 'user' | 'ai'; content: string; timestamp: number; agentActions?: string[]; }
interface ItineraryItem { id: string; text: string; completed: boolean; }
interface ItineraryDay { day: number; title: string; activities: ItineraryItem[]; }
interface BoardNote { id: string; text: string; color: 'yellow' | 'pink' | 'blue' | 'green'; }
interface WeatherData { temp: number; condition: string; icon: string; }

interface TripState {
  id: string;
  name: string;
  destination: string | null;
  startDate: string | null;
  messages: ChatMessage[];
  itinerary: ItineraryDay[];
  notes: BoardNote[];
  weather?: WeatherData | null;
}

/* ============================================
   Constants
   ============================================ */
const QUICK_PROMPTS = [
  { emoji: '🏛️', text: 'Plan 3 days in Jaipur on a budget' },
  { emoji: '🏔️', text: 'Best time to visit Ladakh and what to pack?' },
  { emoji: '🍛', text: 'Best street food trail in Old Delhi' },
];

const SYSTEM_CONTEXT = `You are YatraAI — an enthusiastic, highly knowledgeable AI travel concierge for India.

CRITICAL INSTRUCTIONS (INTERVIEW FLOW):
1. Do NOT immediately dump a huge itinerary.
2. If the user asks to plan a trip, FIRST ask 1-2 clarifying questions (e.g., "Are you looking for luxury or a budget trip?", "Who are you traveling with?").
3. Keep your responses VERY SHORT (1-2 paragraphs max) until you have enough information to build the itinerary.
4. Only when you have enough context, generate the final itinerary.
5. You MUST format the final itinerary explicitly using this exact structure:
   Day 1: [Title]
   - [Activity 1]
   - [Activity 2]

MULTI-DESTINATION RULE:
If the user mentions a NEW destination (e.g., "What about Goa?") while currently discussing another destination (e.g., "Jaipur"), you MUST explicitly ask: "Do you want to club Goa into a multi-city itinerary, or should I tell you how to start a new trip board?" Do not silently overwrite the current plan.

PERSONALITY: Warm, encouraging. Use emojis sparingly.`;

let _counter = 0;
const uid = () => `id_${Date.now()}_${++_counter}`;

/* ============================================
   Helpers
   ============================================ */
function formatResponse(text: string): string {
  return text
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>');
}

function extractItinerary(text: string): ItineraryDay[] {
  const days: ItineraryDay[] = [];
  const dayPattern = /(?:Day\s*(\d+)|(\d+)(?:st|nd|rd|th)\s+Day)[:\s\-–—]*(.+?)(?=(?:Day\s*\d|$))/gis;
  let match;
  while ((match = dayPattern.exec(text)) !== null) {
    const dayNum = parseInt(match[1] || match[2]);
    const content = match[3]?.trim() || '';
    if (dayNum && content) {
      const lines = content.split(/\n|<br\/?>/i).map(l => l.replace(/<[^>]*>/g, '').replace(/^[\s\-•*]+/, '').trim()).filter(Boolean);
      const title = lines[0] || `Day ${dayNum}`;
      const acts = lines.slice(1, 6).map(act => ({ id: uid(), text: act, completed: false }));
      days.push({ day: dayNum, title: title.slice(0, 60), activities: acts });
    }
  }
  return days;
}

function generateICS(itinerary: ItineraryDay[], destination: string, startDateStr: string | null): string {
  let ics = 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//YatraAI//Travel Planner//EN\n';
  const startDate = startDateStr ? new Date(startDateStr) : new Date();
  if (!startDateStr) startDate.setDate(startDate.getDate() + 1);

  itinerary.forEach((day, index) => {
    const eventDate = new Date(startDate); 
    eventDate.setDate(eventDate.getDate() + index);
    const dateStr = eventDate.toISOString().split('T')[0].replace(/-/g, '');
    ics += 'BEGIN:VEVENT\n';
    ics += `DTSTART;VALUE=DATE:${dateStr}\nDTEND;VALUE=DATE:${dateStr}\n`;
    ics += `SUMMARY:Day ${day.day} in ${destination}: ${day.title}\n`;
    ics += `LOCATION:${destination}, India\n`;
    ics += 'END:VEVENT\n';
  });
  ics += 'END:VCALENDAR'; return ics;
}

/* ============================================
   Components
   ============================================ */

const StreamedMessage = ({ content }: { content: string }) => {
  const [displayed, setDisplayed] = useState('');
  useEffect(() => {
    setDisplayed('');
    const interval = setInterval(() => {
      setDisplayed(prev => {
        const next = content.slice(0, prev.length + 3);
        if (next.length >= content.length) clearInterval(interval);
        return next;
      });
    }, 10);
    return () => clearInterval(interval);
  }, [content]);

  return <div className="msg-bubble" dangerouslySetInnerHTML={{ __html: formatResponse(displayed) }} />;
};


export default function App() {
  const [view, setView] = useState<'landing' | 'planner'>('landing');
  const [scrolled, setScrolled] = useState(false);
  
  // Persistent State
  const [trips, setTrips] = useState<TripState[]>(() => {
    const saved = localStorage.getItem('yatraai_trips');
    if (saved) return JSON.parse(saved);
    return [{ id: uid(), name: 'New Trip', destination: null, startDate: null, messages: [], itinerary: [], notes: [] }];
  });
  const [currentTripId, setCurrentTripId] = useState<string>(trips[0].id);

  // Active Trip Accessor
  const trip = trips.find(t => t.id === currentTripId) || trips[0];

  // Ephemeral UI State
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [showFlightsModal, setShowFlightsModal] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recRef = useRef<any>(null);

  useEffect(() => {
    localStorage.setItem('yatraai_trips', JSON.stringify(trips));
  }, [trips]);

  useEffect(() => {
    if (view === 'planner') document.body.classList.add('mode-planner');
    else document.body.classList.remove('mode-planner');
  }, [view]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [trip.messages, loading]);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      const r = new SR();
      r.continuous = false; r.lang = 'en-IN';
      r.onresult = (e: any) => { setInput(e.results[0][0].transcript); setListening(false); setTimeout(() => sendMessage(e.results[0][0].transcript), 200); };
      r.onerror = () => setListening(false); r.onend = () => setListening(false);
      recRef.current = r;
    }
  }, [currentTripId]); 

  const toggleMic = useCallback(() => {
    if (!recRef.current) return alert('Voice not supported.');
    if (listening) { recRef.current.stop(); setListening(false); }
    else { recRef.current.start(); setListening(true); }
  }, [listening]);

  const updateTrip = (id: string, payload: Partial<TripState>) => {
    setTrips(prev => prev.map(t => t.id === id ? { ...t, ...payload } : t));
  };

  const createNewTrip = () => {
    const newTrip: TripState = { id: uid(), name: `Trip ${trips.length + 1}`, destination: null, startDate: null, messages: [], itinerary: [], notes: [] };
    setTrips(prev => [...prev, newTrip]);
    setCurrentTripId(newTrip.id);
  };

  const clearCurrentTrip = () => {
    if (confirm('Are you sure you want to clear this chat and board?')) {
      updateTrip(currentTripId, { messages: [], itinerary: [], notes: [], weather: null, destination: null, startDate: null });
    }
  };

  const sendMessage = async (overrideText?: string) => {
    const text = (overrideText || input).trim();
    if (!text || loading) return;

    if (view === 'landing') setView('planner');

    const newMsg: ChatMessage = { id: uid(), role: 'user', content: text, timestamp: Date.now() };
    const updatedMessages = [...trip.messages, newMsg];
    updateTrip(currentTripId, { messages: updatedMessages });
    setInput('');
    setLoading(true);

    let newDest = trip.destination;
    const destMatch = text.match(/(?:in|to|visit|plan|explore|trip)\s+([A-Z][a-z]+(?: [A-Z][a-z]+)*)/);
    if (destMatch && !trip.destination) {
      newDest = destMatch[1];
      updateTrip(currentTripId, { destination: newDest, name: `${newDest} Trip` });
      
      fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${newDest}&count=1&language=en&format=json`)
        .then(res => res.json())
        .then(geo => {
          if (geo.results?.length) {
             const { latitude, longitude } = geo.results[0];
             return fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
          }
        })
        .then(res => res?.json())
        .then(weatherData => {
           if (weatherData?.current_weather) {
              const temp = Math.round(weatherData.current_weather.temperature);
              updateTrip(currentTripId, { weather: { temp, condition: temp > 30 ? 'Hot' : temp > 20 ? 'Pleasant' : 'Cool', icon: temp > 30 ? '☀️' : temp > 20 ? '⛅' : '❄️' }});
           }
        }).catch(console.error);
    }

    try {
      const history = updatedMessages.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history, systemContext: SYSTEM_CONTEXT }),
      });

      if (!res.ok) throw new Error('API Error');
      const data = await res.json();
      const aiMsg: ChatMessage = { id: uid(), role: 'ai', content: data.response, timestamp: Date.now(), agentActions: Array.isArray(data.agentActions) ? data.agentActions : undefined };
      
      const extracted = extractItinerary(data.response);
      let newItinerary = trip.itinerary;
      let newNotes = trip.notes;
      
      if (extracted.length > 0 && trip.itinerary.length === 0) {
        newItinerary = extracted;
        newNotes = [
          { id: uid(), text: `📍 Trip to ${newDest || 'India'}`, color: 'yellow' },
          { id: uid(), text: `📅 ${extracted.length} days planned`, color: 'blue' },
          { id: uid(), text: `📝 Sync to calendar when ready!`, color: 'green' },
        ];
      }
      
      updateTrip(currentTripId, { 
        messages: [...updatedMessages, aiMsg],
        itinerary: newItinerary,
        notes: newNotes,
        destination: data.mapQuery ? data.mapQuery.replace(', India', '') : newDest
      });

    } catch {
      updateTrip(currentTripId, { messages: [...updatedMessages, { id: uid(), role: 'ai', content: 'Connection error. Please try again.', timestamp: Date.now() }] });
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleDownloadCalendar = () => {
    if (!trip.itinerary.length) return;
    const icsContent = generateICS(trip.itinerary, trip.destination || 'India', trip.startDate);
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.setAttribute('download', `${trip.destination || 'Trip'}_Itinerary.ics`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const toggleChecklist = (dayIdx: number, actIdx: number) => {
    const updatedItinerary = [...trip.itinerary];
    updatedItinerary[dayIdx].activities[actIdx].completed = !updatedItinerary[dayIdx].activities[actIdx].completed;
    updateTrip(currentTripId, { itinerary: updatedItinerary });
  };


  /* === LANDING PAGE === */
  if (view === 'landing') {
    return (
      <>
        <nav className={`navbar ${scrolled ? 'navbar--solid' : 'navbar--transparent'}`}>
          <div className="nav-brand">Yatra<span>AI</span></div>
          <div className="nav-links">
            <span className="nav-link">Destinations</span>
            <span className="nav-pill">Powered by Google Cloud</span>
          </div>
        </nav>
        <header className="hero">
          <div className="hero-bg"><img src="https://images.unsplash.com/photo-1524492412937-b28074a5d7da?auto=format&fit=crop&q=80&w=2000" alt="Taj Mahal" /></div>
          <div className="hero-overlay" />
          <div className="hero-content">
            <h1 className="hero-title">Discover the Soul of Incredible India.</h1>
            <p className="hero-subtitle">Experience the world's most vibrant culture. Plan your bespoke journey seamlessly with our immersive AI Concierge.</p>
            <button className="btn-primary" onClick={() => setView('planner')}>Start Planning with AI <span>→</span></button>
          </div>
          <div className="integrations-strip">
            <div className="integration-item"><span className="integration-icon">✈️</span> Google Flights</div>
            <div className="integration-item"><span className="integration-icon">📅</span> Google Calendar</div>
            <div className="integration-item"><span className="integration-icon">☀️</span> Live Weather</div>
          </div>
        </header>
        <div className="floating-ai" onClick={() => setView('planner')}><div className="pulse"></div>Explore with AI</div>
      </>
    );
  }

  /* === PLANNER: TRAVEL JOURNAL === */
  return (
    <div className="journal-layout">
      
      {/* Left: Chat */}
      <div className="chat-pane">
        <nav className="navbar">
          <div className="nav-brand" onClick={() => setView('landing')}>Yatra<span>AI</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <select 
              value={currentTripId} 
              onChange={e => {
                if (e.target.value === 'new') createNewTrip();
                else setCurrentTripId(e.target.value);
              }}
              style={{ background: 'transparent', color: 'var(--saffron)', border: 'none', outline: 'none', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
            >
              {trips.map(t => <option key={t.id} value={t.id} style={{color: '#000'}}>{t.name}</option>)}
              <option value="new" style={{color: '#000'}}>+ Create New Trip</option>
            </select>
            
            <button 
              onClick={clearCurrentTrip}
              title="Clear Chat & Board"
              style={{ background: 'transparent', border: 'none', color: 'var(--journal-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </nav>
        
        <div className="chat-scroll">
          {trip.messages.length === 0 && (
            <div className="welcome-hero">
              <div className="welcome-icon">🇮🇳</div>
              <div className="welcome-title">Namaste! I'm <em>YatraAI</em></div>
              <p className="welcome-desc">Tell me where you want to go. I will ask a few quick questions to personalize your journey before drafting the itinerary.</p>
              <div className="welcome-chips">
                {QUICK_PROMPTS.map(p => (
                  <button key={p.text} className="chip" onClick={() => { setInput(p.text); sendMessage(p.text); }}>{p.emoji} {p.text}</button>
                ))}
              </div>
            </div>
          )}

          {trip.messages.map((msg, idx) => {
             const isLastAI = msg.role === 'ai' && idx === trip.messages.length - 1;
             return (
              <div key={msg.id} className={`message message--${msg.role}`}>
                <div className={`msg-avatar msg-avatar--${msg.role}`}>{msg.role === 'ai' ? '🇮🇳' : '✦'}</div>
                <div className="msg-content">
                  {msg.role === 'ai' && msg.agentActions && msg.agentActions.length > 0 && (
                    <ul className="agent-actions" aria-label="Agent tool calls">
                      {msg.agentActions.map((action, i) => (
                        <li key={i} className="agent-action-chip">{action}</li>
                      ))}
                    </ul>
                  )}
                  {isLastAI ? <StreamedMessage content={msg.content} /> : (
                    <div className="msg-bubble" dangerouslySetInnerHTML={{ __html: msg.role === 'ai' ? formatResponse(msg.content) : msg.content }} />
                  )}
                </div>
              </div>
             );
          })}

          {loading && (
            <div className="message message--ai">
              <div className="msg-avatar msg-avatar--ai">🇮🇳</div>
              <div className="msg-bubble" style={{ color: 'var(--journal-text-muted)', display: 'flex', gap: '0.2rem', alignItems: 'center' }}>
                <span className="pulse" style={{width: 6, height: 6}}></span>
                <span className="pulse" style={{width: 6, height: 6, animationDelay: '0.2s'}}></span>
                <span className="pulse" style={{width: 6, height: 6, animationDelay: '0.4s'}}></span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <form className="input-dock" onSubmit={e => { e.preventDefault(); sendMessage(); }}>
          <div className="input-row">
            <button type="button" className={`btn-round btn-mic ${listening ? 'btn-mic--on' : ''}`} onClick={toggleMic}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>
            </button>
            <textarea
              ref={inputRef}
              className="input-field"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder={listening ? 'Listening...' : 'Message YatraAI...'}
              rows={1}
            />
            <button type="submit" className="btn-round btn-send" disabled={!input.trim() || loading}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/></svg>
            </button>
          </div>
        </form>
      </div>

      {/* Right: Board */}
      <aside className="board-pane">
        <div className="board-header">
          <div>
            <div className="board-title">Trip Board</div>
            <div className="board-sub" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {trip.name} 
              <input 
                type="date" 
                value={trip.startDate || ''}
                onChange={e => updateTrip(currentTripId, { startDate: e.target.value })}
                style={{ background: 'var(--journal-warm)', border: '1px solid var(--journal-border)', color: 'var(--saffron)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', outline: 'none' }}
                title="Set Start Date"
              />
            </div>
          </div>
          <button className="btn-round" onClick={() => {
            const text = prompt('Add note:');
            if (text) updateTrip(currentTripId, { notes: [...trip.notes, { id: uid(), text, color: ['yellow', 'pink', 'blue', 'green'][trip.notes.length % 4] as any }] });
          }} style={{ background: 'var(--journal-warm)', border: '1px solid var(--journal-border)', color: 'white' }}>+</button>
        </div>

        <div className="board-scroll">
          {trip.messages.length > 0 ? (
            <>
              {/* Colorful Integrations */}
              <div className="integrations-grid">
                {trip.weather && (
                  <div className="int-card" style={{ borderColor: 'rgba(250, 204, 21, 0.3)' }}>
                    <div className="int-icon">{trip.weather.icon}</div>
                    <div><div className="int-label" style={{ color: '#facc15' }}>Weather</div><div className="int-value">{trip.weather.temp}°C {trip.weather.condition}</div></div>
                  </div>
                )}
                {trip.destination && (
                  <div className="int-card" onClick={() => setShowFlightsModal(true)} style={{ borderColor: 'rgba(56, 189, 248, 0.3)' }}>
                    <div className="int-icon" style={{ color: '#38bdf8' }}>✈️</div>
                    <div><div className="int-label" style={{ color: '#38bdf8' }}>Google Flights</div><div className="int-value" style={{ color: '#e0f2fe' }}>Check Fares</div></div>
                  </div>
                )}
                {trip.itinerary.length > 0 && (
                   <div className="int-card" onClick={handleDownloadCalendar} style={{ borderColor: 'rgba(167, 139, 250, 0.3)' }}>
                     <div className="int-icon" style={{ color: '#a78bfa' }}>📅</div>
                     <div><div className="int-label" style={{ color: '#a78bfa' }}>Google Calendar</div><div className="int-value" style={{ color: '#ede9fe' }}>Sync Trip</div></div>
                   </div>
                )}
              </div>

              {/* Stickies */}
              <div className="stickies">
                {trip.notes.map(note => (
                  <div key={note.id} className={`sticky sticky--${note.color}`} onClick={() => {
                    const newText = prompt('Edit note:', note.text);
                    if (newText) updateTrip(currentTripId, { notes: trip.notes.map(n => n.id === note.id ? { ...n, text: newText } : n) });
                  }}>{note.text}</div>
                ))}
              </div>

              {/* Timeline with Checklists */}
              {trip.itinerary.length > 0 && (
                <div className="timeline">
                  <h3 style={{ fontFamily: 'var(--font-hand)', color: 'var(--journal-text-muted)', fontSize: '1.2rem', marginBottom: '-1rem' }}>Stages of Journey</h3>
                  {trip.itinerary.map((day, dIdx) => (
                    <div key={day.day} className="day-block">
                      <div className="day-label">Day {day.day}</div>
                      <div className="day-title">{day.title}</div>
                      <ul className="day-list" style={{ listStyle: 'none', padding: 0 }}>
                        {day.activities.map((act, aIdx) => (
                          <li key={act.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.5rem', cursor: 'pointer' }} onClick={() => toggleChecklist(dIdx, aIdx)}>
                            <div style={{
                              width: '18px', height: '18px', borderRadius: '4px', border: `1px solid ${act.completed ? 'var(--emerald)' : 'var(--journal-border)'}`,
                              background: act.completed ? 'var(--emerald)' : 'var(--journal-input)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '2px', flexShrink: 0
                            }}>
                              {act.completed && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg>}
                            </div>
                            <span style={{ fontSize: '0.85rem', color: act.completed ? 'var(--journal-text-muted)' : 'rgba(255,255,255,0.8)', textDecoration: act.completed ? 'line-through' : 'none' }}>
                              {act.text}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="empty-board">
              <div className="empty-icon">📝</div>
              <div className="empty-text">Your board is empty</div>
              <div style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>Start chatting to populate your itinerary, weather, and notes.</div>
            </div>
          )}
        </div>
      </aside>

      {/* Flights Modal Overlay */}
      {showFlightsModal && (
        <div className="modal-overlay" onClick={() => setShowFlightsModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowFlightsModal(false)}>×</button>
            <h2 style={{ fontFamily: 'var(--font-serif)', color: 'white', marginBottom: '1rem', fontSize: '2rem' }}>
              Flights to {trip.destination}
            </h2>
            <div style={{ background: 'var(--journal-input)', padding: '1.5rem', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid var(--journal-border)' }}>
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', color: 'var(--journal-text-muted)', fontSize: '0.85rem' }}>
                 <span>Searching exact fares for {trip.startDate || 'your selected dates'}...</span>
                 <span style={{ color: '#38bdf8' }}>Powered by Google</span>
               </div>
               <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '6px' }}>
                 <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: 'white' }}>Average Fare</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--journal-text-muted)' }}>Round trip, Economy</div>
                 </div>
                 <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#10b981' }}>Est. ₹4,500+</div>
               </div>
            </div>
            <button 
              className="btn-primary" 
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => {
                setShowFlightsModal(false);
                window.open(`https://www.google.com/travel/flights?q=flights+to+${trip.destination}`, '_blank');
              }}
            >
              View Live Pricing on Google Flights ↗
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

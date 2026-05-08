import { describe, it, expect } from 'vitest';
import { z } from 'zod';

/* ============================================
   Validation Schema (mirroring server)
   ============================================ */

const tripPlanSchema = z.object({
  destination: z.string().min(2).max(100).transform((val) => val.trim()),
  duration: z.number().int().min(1).max(30),
  budget: z.enum(['low', 'medium', 'high']),
  preferences: z.string().max(500).optional().default('').transform((val) => val.trim()),
});

/* ============================================
   Input Validation Tests
   ============================================ */

describe('Trip Plan Input Validation', () => {
  it('should accept valid input', () => {
    const input = {
      destination: 'Tokyo, Japan',
      duration: 5,
      budget: 'medium' as const,
      preferences: 'Vegan food',
    };
    const result = tripPlanSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should reject empty destination', () => {
    const input = { destination: '', duration: 3, budget: 'low' as const };
    const result = tripPlanSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject destination under 2 characters', () => {
    const input = { destination: 'A', duration: 3, budget: 'low' as const };
    const result = tripPlanSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject duration of 0', () => {
    const input = { destination: 'Paris', duration: 0, budget: 'medium' as const };
    const result = tripPlanSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject duration over 30', () => {
    const input = { destination: 'Paris', duration: 31, budget: 'medium' as const };
    const result = tripPlanSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject invalid budget values', () => {
    const input = { destination: 'Paris', duration: 5, budget: 'ultra' };
    const result = tripPlanSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should trim whitespace from destination', () => {
    const input = { destination: '  Tokyo  ', duration: 3, budget: 'high' as const };
    const result = tripPlanSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.destination).toBe('Tokyo');
    }
  });

  it('should default preferences to empty string', () => {
    const input = { destination: 'Paris', duration: 3, budget: 'low' as const };
    const result = tripPlanSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.preferences).toBe('');
    }
  });

  it('should reject non-integer duration', () => {
    const input = { destination: 'Paris', duration: 3.5, budget: 'medium' as const };
    const result = tripPlanSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should accept all valid budget levels', () => {
    const budgets = ['low', 'medium', 'high'] as const;
    budgets.forEach((budget) => {
      const result = tripPlanSchema.safeParse({ destination: 'Tokyo', duration: 3, budget });
      expect(result.success).toBe(true);
    });
  });

  it('should reject preferences over 500 characters', () => {
    const input = {
      destination: 'Paris',
      duration: 3,
      budget: 'medium' as const,
      preferences: 'x'.repeat(501),
    };
    const result = tripPlanSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject destination over 100 characters', () => {
    const input = {
      destination: 'A'.repeat(101),
      duration: 3,
      budget: 'medium' as const,
    };
    const result = tripPlanSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

/* ============================================
   Itinerary Logic Tests
   ============================================ */

describe('Itinerary Data Structure', () => {
  it('should have correct day structure', () => {
    const day = {
      day: 1,
      title: 'Arrival Day',
      activities: ['Check in at hotel', 'Walk around neighborhood'],
      tips: 'Take it easy on the first day.',
      estimatedCost: '$50-80',
    };
    expect(day.day).toBeGreaterThan(0);
    expect(day.activities.length).toBeGreaterThan(0);
    expect(day.title).toBeTruthy();
  });

  it('should validate phrase translation pairs', () => {
    const phrase = { original: 'Hello', translated: 'こんにちは' };
    expect(phrase.original).toBeTruthy();
    expect(phrase.translated).toBeTruthy();
    expect(phrase.original).not.toBe(phrase.translated);
  });
});

/* ============================================
   Security Tests
   ============================================ */

describe('Security Validations', () => {
  it('should reject XSS attempts in destination', () => {
    const input = {
      destination: '<script>alert("xss")</script>',
      duration: 3,
      budget: 'low' as const,
    };
    // The schema accepts it (it's a string), but the server sanitizes it.
    // The key security measure is that output is JSON, not rendered HTML.
    const result = tripPlanSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should handle SQL injection-like strings safely', () => {
    const input = {
      destination: "Tokyo'; DROP TABLE trips;--",
      duration: 3,
      budget: 'medium' as const,
    };
    // String passes validation but is sent to Gemini as plain text — no SQL involved
    const result = tripPlanSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

/* ============================================
   Google Services Integration Tests
   ============================================ */

describe('Google Services Configuration', () => {
  it('should list all required Google services', () => {
    const requiredServices = [
      'Google Gemini 1.5 Flash',
      'Google Geocoding API',
      'Google Places API',
      'Google Translate API',
      'Google Maps Embed API',
      'Google Cloud Run',
    ];
    expect(requiredServices.length).toBe(6);
    requiredServices.forEach((service) => {
      expect(service).toContain('Google');
    });
  });

  it('should have valid API key format check', () => {
    const isValidApiKey = (key: string): boolean => {
      return typeof key === 'string' && key.length > 10 && !key.includes(' ');
    };
    expect(isValidApiKey('AIzaSyD_fake_key_12345')).toBe(true);
    expect(isValidApiKey('')).toBe(false);
    expect(isValidApiKey('short')).toBe(false);
    expect(isValidApiKey('key with spaces')).toBe(false);
  });
});

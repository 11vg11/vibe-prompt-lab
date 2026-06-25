import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import NodeCache from 'node-cache';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Axios instance with retry & timeout ────────────────────────────────────
const api = axios.create({
  timeout: 8000, // 8-second hard timeout on every outgoing request
  headers: { 'Accept-Encoding': 'gzip, deflate' }
});

axiosRetry(api, {
  retries: 3,
  retryDelay: (retryCount) => axiosRetry.exponentialDelay(retryCount), // 1s → 2s → 4s
  retryCondition: (error) => {
    // Retry on network errors + 5xx + 429 (rate limited)
    return (
      axiosRetry.isNetworkOrIdempotentRequestError(error) ||
      (error.response && (error.response.status >= 500 || error.response.status === 429))
    );
  },
  onRetry: (retryCount, error, requestConfig) => {
    console.warn(`[Retry ${retryCount}] ${requestConfig.url} — ${error.message}`);
  }
});

// ─── Circuit Breaker for Tomorrow.io ────────────────────────────────────────
const circuitBreaker = {
  failures: 0,
  maxFailures: 5,
  resetTimeout: 5 * 60 * 1000, // 5 minutes
  lastFailureTime: 0,
  isOpen() {
    if (this.failures >= this.maxFailures) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed < this.resetTimeout) {
        return true; // Circuit is open — skip Tomorrow.io
      }
      // Half-open: allow one attempt to test if it's back
      this.failures = 0;
    }
    return false;
  },
  recordFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.maxFailures) {
      console.warn(`[CircuitBreaker] Tomorrow.io circuit OPEN — skipping for ${this.resetTimeout / 1000}s`);
    }
  },
  recordSuccess() {
    this.failures = 0;
  }
};

// ─── Cache with automatic TTL expiry ────────────────────────────────────────
// stdTTL = default TTL in seconds, checkperiod = cleanup interval in seconds
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120, useClones: false });

// Stale-while-revalidate: separate stale store
const staleCache = new NodeCache({ stdTTL: 3600, checkperiod: 300, useClones: false });

function getCacheWithStale(key) {
  const fresh = cache.get(key);
  if (fresh) return { data: fresh, stale: false };

  const stale = staleCache.get(key);
  if (stale) return { data: stale, stale: true };

  return { data: null, stale: false };
}

function setCache(key, data, ttlSeconds) {
  cache.set(key, data, ttlSeconds);
  staleCache.set(key, data, ttlSeconds * 6); // Keep stale data 6× longer
}

// ─── Middleware ──────────────────────────────────────────────────────────────

// Gzip/brotli compression for all responses
app.use(compression({
  level: 6,
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// Security headers (relaxed for fonts/styles/inline)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://ipapi.co"],
    }
  },
  crossOriginEmbedderPolicy: false, // Allow loading fonts cross-origin
}));

app.use(cors());
app.use(express.json());

// Rate limit on API routes: 100 requests per 15 min per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.', retryAfter: 900 }
});
app.use('/api/', apiLimiter);

// Serve static assets with long-term cache headers
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
}));

// ─── Tomorrow.io → WMO Code Mapping ────────────────────────────────────────
function mapTomorrowCodeToWmo(code) {
  const mapping = {
    1000: 0,   // Clear, Sunny
    1100: 1,   // Mostly Clear
    1101: 2,   // Partly Cloudy
    1102: 3,   // Mostly Cloudy
    1001: 3,   // Cloudy
    2000: 45,  // Fog
    2100: 45,  // Light Fog
    4000: 51,  // Drizzle
    4200: 61,  // Light Rain
    4001: 63,  // Rain
    4201: 65,  // Heavy Rain
    5000: 73,  // Snow
    5100: 71,  // Light Snow
    5001: 71,  // Flurries
    5101: 75,  // Heavy Snow
    6000: 56,  // Freezing Drizzle
    6001: 66,  // Freezing Rain
    6200: 66,  // Light Freezing Rain
    6201: 67,  // Heavy Freezing Rain
    7000: 77,  // Ice Pellets
    7101: 77,  // Heavy Ice Pellets
    7102: 77,  // Light Ice Pellets
    8000: 95,  // Thunderstorm
  };
  return mapping[code] !== undefined ? mapping[code] : 0;
}

// ─── Shared fetcher: Tomorrow.io with circuit breaker ───────────────────────
async function fetchTomorrowWeather(lat, lon) {
  const tomorrowKey = process.env.TOMORROW_IO_API_KEY;
  if (!tomorrowKey || tomorrowKey === 'your_tomorrow_io_api_key_here') return null;
  if (circuitBreaker.isOpen()) {
    console.log('[Weather] Tomorrow.io circuit is OPEN — skipping');
    return null;
  }

  try {
    console.log(`[Weather] Querying Tomorrow.io for lat=${lat}, lon=${lon}`);
    const { data } = await api.get(`https://api.tomorrow.io/v4/weather/forecast`, {
      params: { location: `${lat},${lon}`, apikey: tomorrowKey }
    });

    const hourlyTimeline = data.timelines.hourly;
    const dailyTimeline = data.timelines.daily;
    const firstHour = hourlyTimeline[0];
    const firstDaily = dailyTimeline[0];

    const isDayForHour = (hourTime, sunriseStr, sunsetStr) => {
      const t = new Date(hourTime);
      const r = new Date(sunriseStr);
      const s = new Date(sunsetStr);
      return (t >= r && t <= s) ? 1 : 0;
    };

    const getSunriseSunsetForDate = (hourTime) => {
      const dateStr = hourTime.slice(0, 10);
      const dayMatch = dailyTimeline.find(d => d.time.startsWith(dateStr)) || firstDaily;
      return {
        sunrise: dayMatch.values.sunriseTime,
        sunset: dayMatch.values.sunsetTime
      };
    };

    const current = {
      temperature_2m: firstHour.values.temperature,
      relative_humidity_2m: firstHour.values.humidity,
      apparent_temperature: firstHour.values.temperatureApparent || firstHour.values.temperature,
      is_day: isDayForHour(firstHour.time, firstDaily.values.sunriseTime, firstDaily.values.sunsetTime),
      weather_code: mapTomorrowCodeToWmo(firstHour.values.weatherCode),
      wind_speed_10m: firstHour.values.windSpeed * 3.6,
      wind_direction_10m: firstHour.values.windDirection,
      surface_pressure: firstHour.values.pressureSurfaceLevel
    };

    const hourly = {
      time: hourlyTimeline.slice(0, 48).map(h => h.time),
      temperature_2m: hourlyTimeline.slice(0, 48).map(h => h.values.temperature),
      relative_humidity_2m: hourlyTimeline.slice(0, 48).map(h => h.values.humidity),
      weather_code: hourlyTimeline.slice(0, 48).map(h => mapTomorrowCodeToWmo(h.values.weatherCode)),
      wind_speed_10m: hourlyTimeline.slice(0, 48).map(h => h.values.windSpeed * 3.6),
      precipitation_probability: hourlyTimeline.slice(0, 48).map(h => h.values.precipitationProbability || 0),
      is_day: hourlyTimeline.slice(0, 48).map(h => {
        const ss = getSunriseSunsetForDate(h.time);
        return isDayForHour(h.time, ss.sunrise, ss.sunset);
      })
    };

    const daily = {
      time: dailyTimeline.map(d => d.time.slice(0, 10)),
      weather_code: dailyTimeline.map(d => mapTomorrowCodeToWmo(d.values.weatherCodeMax || d.values.weatherCode)),
      temperature_2m_max: dailyTimeline.map(d => d.values.temperatureMax),
      temperature_2m_min: dailyTimeline.map(d => d.values.temperatureMin),
      sunrise: dailyTimeline.map(d => d.values.sunriseTime),
      sunset: dailyTimeline.map(d => d.values.sunsetTime),
      uv_index_max: dailyTimeline.map(d => d.values.uvIndexMax || 0)
    };

    circuitBreaker.recordSuccess();
    return { current, hourly, daily };
  } catch (error) {
    circuitBreaker.recordFailure();
    console.warn(`[Weather] Tomorrow.io failed: ${error.message}`);
    return null;
  }
}

// ─── Shared fetcher: Open-Meteo (always-available fallback) ─────────────────
async function fetchOpenMeteoWeather(lat, lon, tz) {
  console.log(`[Weather] Querying Open-Meteo for lat=${lat}, lon=${lon}`);
  const { data } = await api.get('https://api.open-meteo.com/v1/forecast', {
    params: {
      latitude: lat,
      longitude: lon,
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,relative_humidity_2m',
      hourly: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,precipitation_probability,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max',
      timezone: tz
    }
  });
  return data;
}

// ─── Unified weather fetcher (with cache + stale-while-revalidate) ──────────
async function getWeather(lat, lon, tz = 'auto') {
  const cacheKey = `weather:${lat}:${lon}`;
  const cached = getCacheWithStale(cacheKey);

  if (cached.data && !cached.stale) {
    return cached.data; // Fresh cache hit
  }

  // If stale, start background refresh but return stale data immediately
  const fetchFresh = async () => {
    // Try Tomorrow.io first
    const tomorrowData = await fetchTomorrowWeather(lat, lon);
    if (tomorrowData) {
      const payload = {
        latitude: parseFloat(lat),
        longitude: parseFloat(lon),
        timezone: tz,
        ...tomorrowData
      };
      setCache(cacheKey, payload, 600); // 10 min
      return payload;
    }

    // Fallback to Open-Meteo
    const data = await fetchOpenMeteoWeather(lat, lon, tz);
    setCache(cacheKey, data, 600);
    return data;
  };

  if (cached.stale) {
    // Return stale data immediately, refresh in background
    fetchFresh().catch(err => console.error('[Background refresh failed]', err.message));
    return cached.data;
  }

  // No cache at all — must wait for fresh data
  return await fetchFresh();
}

// ─── API Routes ─────────────────────────────────────────────────────────────

// Geocoding Proxy Endpoint
app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  const cacheKey = `search:${q.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN;

  // Try Mapbox if key is present
  if (mapboxToken && mapboxToken !== 'your_mapbox_access_token_here') {
    try {
      console.log(`[Search] Querying Mapbox for "${q}"`);
      const { data } = await api.get(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`,
        { params: { access_token: mapboxToken, limit: 10, types: 'place' } }
      );

      // Transform Mapbox to Open-Meteo shape for frontend compatibility
      const results = (data.features || []).map(f => {
        const [lon, lat] = f.center;
        let country = '';
        let admin1 = '';
        if (f.context) {
          const countryObj = f.context.find(c => c.id.startsWith('country'));
          const regionObj = f.context.find(c => c.id.startsWith('region'));
          if (countryObj) country = countryObj.text;
          if (regionObj) admin1 = regionObj.text;
        }
        return {
          name: f.text,
          latitude: lat,
          longitude: lon,
          country: country,
          admin1: admin1,
          timezone: 'auto'
        };
      });

      const responsePayload = { results };
      setCache(cacheKey, responsePayload, 86400); // 24h
      return res.json(responsePayload);
    } catch (error) {
      console.warn('Mapbox Geocoding failed, falling back to Open-Meteo:', error.message);
    }
  }

  // Fallback: Open-Meteo Geocoding
  try {
    console.log(`[Search] Querying Open-Meteo for "${q}"`);
    const { data } = await api.get('https://geocoding-api.open-meteo.com/v1/search', {
      params: { name: q, count: 10, language: 'en', format: 'json' }
    });
    setCache(cacheKey, data, 86400); // 24h
    res.json(data);
  } catch (error) {
    console.error('All geocoding APIs failed:', error.message);
    res.status(500).json({ error: 'Failed to search for locations' });
  }
});

// Weather Proxy Endpoint (single city)
app.get('/api/weather', async (req, res) => {
  const { lat, lon, timezone } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ error: 'Latitude and longitude parameters are required' });
  }

  try {
    const data = await getWeather(lat, lon, timezone || 'auto');
    res.json(data);
  } catch (error) {
    console.error('All weather APIs failed:', error.message);
    res.status(500).json({ error: 'Failed to retrieve weather data', retryAfter: 30 });
  }
});

// Batch Weather Endpoint — fetch multiple cities in parallel
app.post('/api/weather/batch', async (req, res) => {
  const { cities } = req.body;
  if (!Array.isArray(cities) || cities.length === 0) {
    return res.status(400).json({ error: 'Request body must contain a "cities" array' });
  }

  // Limit to 20 cities max
  const limited = cities.slice(0, 20);

  // Fetch all in parallel with concurrency limit via Promise.allSettled
  const results = await Promise.allSettled(
    limited.map(city =>
      getWeather(city.lat, city.lon, city.timezone || 'auto')
        .then(data => ({ id: city.id, data, error: null }))
        .catch(err => ({ id: city.id, data: null, error: err.message }))
    )
  );

  const response = results.map(r => {
    if (r.status === 'fulfilled') return r.value;
    return { id: null, data: null, error: r.reason?.message || 'Unknown error' };
  });

  res.json({ results: response });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    cacheStats: cache.getStats(),
    circuitBreaker: {
      failures: circuitBreaker.failures,
      isOpen: circuitBreaker.isOpen()
    }
  });
});

// Fallback to index.html for single page application styling if needed
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`⚡ Server is running at http://localhost:${PORT}`);
  console.log(`   Compression: enabled`);
  console.log(`   Rate limit: 100 req/15min per IP`);
  console.log(`   Cache TTL: 10 min (weather), 24h (search)`);
  console.log(`   Retry: 3× exponential backoff, 8s timeout`);
});

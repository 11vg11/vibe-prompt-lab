// macOS Weather App - Frontend Interactive Logic

// State management
const DEFAULT_CITIES = [
  { id: 'cupertino', name: 'Cupertino', lat: 37.323, lon: -122.032, timezone: 'America/Los_Angeles' },
  { id: 'london', name: 'London', lat: 51.507, lon: -0.128, timezone: 'Europe/London' },
  { id: 'tokyo', name: 'Tokyo', lat: 35.689, lon: 139.692, timezone: 'Asia/Tokyo' },
  { id: 'paris', name: 'Paris', lat: 48.857, lon: 2.352, timezone: 'Europe/Paris' }
];

let savedCities = [];
let activeCityId = '';
let searchTimeout = null;

// Safe localStorage Helpers
function safeGetStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn(`localStorage read failed for key "${key}":`, e);
    return null;
  }
}

function safeSetStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn(`localStorage write failed for key "${key}":`, e);
    return false;
  }
}

// Initial setup
document.addEventListener('DOMContentLoaded', () => {
  initSavedCities();
  setupEventListeners();
});

// Initialize saved cities from local storage or defaults (with ipapi.co auto-location)
async function initSavedCities() {
  const localData = safeGetStorage('macos_weather_saved_cities');
  if (localData) {
    try {
      savedCities = JSON.parse(localData);
    } catch (e) {
      console.error('Failed to parse saved cities, resetting to defaults', e);
      savedCities = [...DEFAULT_CITIES];
    }
    setupActiveCity();
  } else {
    // Show skeleton/loader state while detecting location
    showLoader();
    try {
      console.log('Detecting user location via ipapi.co...');
      const res = await fetch('https://ipapi.co/json/');
      if (!res.ok) throw new Error(`ipapi.co returned status ${res.status}`);
      const data = await res.json();
      
      if (data.city && data.latitude && data.longitude) {
        const detectedCity = {
          id: `${data.city.toLowerCase().replace(/\s+/g, '-')}-${data.latitude.toFixed(2)}-${data.longitude.toFixed(2)}`,
          name: data.city,
          lat: data.latitude,
          lon: data.longitude,
          timezone: data.timezone || 'auto'
        };
        // Place detected city first, filter duplicates
        savedCities = [
          detectedCity, 
          ...DEFAULT_CITIES.filter(c => c.name.toLowerCase() !== data.city.toLowerCase())
        ];
        console.log(`Detected city: ${detectedCity.name}`);
      } else {
        throw new Error('Incomplete location payload from ipapi.co');
      }
    } catch (err) {
      console.warn('Location detection failed, using defaults:', err.message);
      savedCities = [...DEFAULT_CITIES];
    }
    
    safeSetStorage('macos_weather_saved_cities', JSON.stringify(savedCities));
    setupActiveCity();
  }
}

function setupActiveCity() {
  const activeId = safeGetStorage('macos_weather_active_city_id');
  if (activeId && savedCities.some(c => c.id === activeId)) {
    activeCityId = activeId;
  } else if (savedCities.length > 0) {
    activeCityId = savedCities[0].id;
    safeSetStorage('macos_weather_active_city_id', activeCityId);
  }
  
  renderSavedCitiesList();
  loadActiveCityWeather();
}

// Setup standard event listeners
function setupEventListeners() {
  // Sidebar Toggle
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });

  // Search input typing
  const searchInput = document.getElementById('city-search');
  const clearBtn = document.getElementById('search-clear-btn');
  const resultsDropdown = document.getElementById('search-results');

  searchInput.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (val.length > 0) {
      clearBtn.style.display = 'flex';
      
      // Debounce search requests (300ms)
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        performSearch(val);
      }, 300);
    } else {
      clearBtn.style.display = 'none';
      resultsDropdown.style.display = 'none';
      resultsDropdown.innerHTML = '';
    }
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.style.display = 'none';
    resultsDropdown.style.display = 'none';
    resultsDropdown.innerHTML = '';
    searchInput.focus();
  });

  // Close dropdown on click outside
  document.addEventListener('click', (e) => {
    if (!searchInput.contains(e.target) && !resultsDropdown.contains(e.target)) {
      resultsDropdown.style.display = 'none';
    }
  });
}

// Perform search via API proxy
async function performSearch(query) {
  const resultsDropdown = document.getElementById('search-results');
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();
    
    if (data.results && data.results.length > 0) {
      renderSearchResults(data.results);
    } else {
      resultsDropdown.innerHTML = '<div style="padding: 12px; font-size: 11px; color: rgba(255,255,255,0.45); text-align: center;">No cities found</div>';
      resultsDropdown.style.display = 'block';
    }
  } catch (err) {
    console.error('Error searching:', err);
    resultsDropdown.innerHTML = '<div style="padding: 12px; font-size: 11px; color: rgba(255,255,255,0.45); text-align: center;">Error searching</div>';
    resultsDropdown.style.display = 'block';
  }
}

// Render the dropdown search results
function renderSearchResults(results) {
  const dropdown = document.getElementById('search-results');
  dropdown.innerHTML = '';
  
  results.forEach(city => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    
    const cityName = city.name;
    const region = city.admin1 ? `${city.admin1}, ` : '';
    const country = city.country || '';
    const fullLoc = `${region}${country}`;
    
    item.innerHTML = `
      <span class="result-name">${cityName}</span>
      <span class="result-country">${fullLoc}</span>
    `;
    
    item.addEventListener('click', () => {
      // Add to saved list
      const cityId = `${city.name.toLowerCase().replace(/\s+/g, '-')}-${city.latitude.toFixed(2)}-${city.longitude.toFixed(2)}`;
      
      // Check if already in saved cities
      if (!savedCities.some(c => c.id === cityId)) {
        const newCity = {
          id: cityId,
          name: city.name,
          lat: city.latitude,
          lon: city.longitude,
          timezone: city.timezone || 'auto'
        };
        savedCities.push(newCity);
        safeSetStorage('macos_weather_saved_cities', JSON.stringify(savedCities));
      }
      
      activeCityId = cityId;
      safeSetStorage('macos_weather_active_city_id', activeCityId);
      
      // Clean up search UI
      document.getElementById('city-search').value = '';
      document.getElementById('search-clear-btn').style.display = 'none';
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
      
      renderSavedCitiesList();
      loadActiveCityWeather();
    });
    
    dropdown.appendChild(item);
  });
  
  dropdown.style.display = 'block';
}

// Render the sidebar list of saved locations
async function renderSavedCitiesList() {
  const listContainer = document.getElementById('saved-cities-list');
  listContainer.innerHTML = '';
  
  for (const city of savedCities) {
    const card = document.createElement('div');
    card.className = `saved-city-card ${city.id === activeCityId ? 'active' : ''}`;
    
    // Create card framework
    card.innerHTML = `
      <div class="card-left">
        <span class="card-city">${city.name}</span>
        <span class="card-time" id="time-${city.id}">--:--</span>
        <span class="card-desc" id="desc-${city.id}">Loading...</span>
      </div>
      <div class="card-right">
        <span class="card-temp" id="temp-${city.id}">--°</span>
        <button class="delete-city-btn" title="Remove Location">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    `;
    
    // Add event listener to load weather for this city
    card.addEventListener('click', (e) => {
      // Don't click trigger if delete button was clicked
      if (e.target.closest('.delete-city-btn')) return;
      
      activeCityId = city.id;
      safeSetStorage('macos_weather_active_city_id', activeCityId);
      
      // Update active highlight classes
      document.querySelectorAll('.saved-city-card').forEach(el => el.classList.remove('active'));
      card.classList.add('active');
      
      loadActiveCityWeather();
    });
    
    // Add event listener to delete button
    const deleteBtn = card.querySelector('.delete-city-btn');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      savedCities = savedCities.filter(c => c.id !== city.id);
      safeSetStorage('macos_weather_saved_cities', JSON.stringify(savedCities));
      
      if (activeCityId === city.id && savedCities.length > 0) {
        activeCityId = savedCities[0].id;
        safeSetStorage('macos_weather_active_city_id', activeCityId);
      }
      
      renderSavedCitiesList();
      if (savedCities.length > 0) {
        loadActiveCityWeather();
      } else {
        // Empty state
        showEmptyState();
      }
    });
    
    listContainer.appendChild(card);
  }

  // Fetch basic weather for saved city cards in parallel (Promise.all)
  if (savedCities.length > 0) {
    Promise.all(savedCities.map(city => fetchCardPreviewData(city))).catch(err => {
      console.error('Error loading previews in parallel:', err);
    });
  }
}

// Fetch basic weather for saved city cards
async function fetchCardPreviewData(city) {
  try {
    const res = await fetch(`/api/weather?lat=${city.lat}&lon=${city.lon}&timezone=${city.timezone}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    
    const current = data.current;
    const temp = Math.round(current.temperature_2m);
    const desc = getWeatherDescription(current.weather_code);
    
    // Update city local time
    const timeElement = document.getElementById(`time-${city.id}`);
    const tempElement = document.getElementById(`temp-${city.id}`);
    const descElement = document.getElementById(`desc-${city.id}`);
    
    if (tempElement) tempElement.textContent = `${temp}°`;
    if (descElement) descElement.textContent = desc;
    
    // Calculate local time for city
    if (timeElement) {
      const options = { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: data.timezone };
      timeElement.textContent = new Date().toLocaleTimeString('en-US', options);
    }
  } catch (err) {
    console.error(`Error loading preview for ${city.name}:`, err);
  }
}

let isInitialLoad = true;

// Display welcome loader
function showLoader(useSkeleton = false) {
  if (useSkeleton) {
    document.getElementById('weather-skeleton').style.display = 'flex';
    document.getElementById('weather-dashboard').style.display = 'none';
    document.getElementById('welcome-loader').style.display = 'none';
  } else {
    document.getElementById('welcome-loader').style.display = 'flex';
    document.getElementById('weather-dashboard').style.display = 'none';
    document.getElementById('weather-skeleton').style.display = 'none';
  }
}

// Hide welcome loader
function hideLoader() {
  document.getElementById('welcome-loader').style.display = 'none';
  document.getElementById('weather-skeleton').style.display = 'none';
  document.getElementById('weather-dashboard').style.display = 'block';
}

// Show empty state when all cities deleted
function showEmptyState() {
  const mainContent = document.getElementById('main-content');
  mainContent.innerHTML = `
    <div class="loader-container">
      <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
      <p style="color: rgba(255,255,255,0.7); font-size: 14px; font-weight: 500;">No saved cities. Search and select a city to begin!</p>
    </div>
  `;
}

// Load full weather data for active city
async function loadActiveCityWeather() {
  if (!activeCityId) return;
  const city = savedCities.find(c => c.id === activeCityId);
  if (!city) return;
  
  showLoader(!isInitialLoad);
  
  try {
    const res = await fetch(`/api/weather?lat=${city.lat}&lon=${city.lon}&timezone=${city.timezone}`);
    if (!res.ok) throw new Error('Failed to retrieve weather');
    const data = await res.json();
    
    renderFullDashboard(city.name, data);
    hideLoader();
    isInitialLoad = false;
  } catch (err) {
    console.error('Error loading full weather:', err);
    const errorTarget = isInitialLoad ? 'welcome-loader' : 'weather-skeleton';
    document.getElementById(errorTarget).innerHTML = `
      <div class="loader-container" style="flex-direction: column;">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="#ff5f56" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        <p style="color: #ff5f56; font-weight: 600; margin: 12px 0 6px;">Failed to connect to weather service.</p>
        <button onclick="loadActiveCityWeather()" class="header-btn" style="margin: 6px auto; background:rgba(255,255,255,0.1); padding:6px 14px; width:auto; height:auto; font-size:12px; border-radius: 6px;">Retry</button>
      </div>
    `;
    if (!isInitialLoad) {
      document.getElementById('weather-skeleton').style.display = 'flex';
      document.getElementById('weather-dashboard').style.display = 'none';
    }
  }
}

// Render complete dashboard data
function renderFullDashboard(cityName, data) {
  const current = data.current;
  const hourly = data.hourly;
  const daily = data.daily;
  
  // Set overview details
  document.getElementById('weather-city').textContent = cityName;
  document.getElementById('weather-temp').textContent = `${Math.round(current.temperature_2m)}°`;
  document.getElementById('weather-desc').textContent = getWeatherDescription(current.weather_code);
  
  const todayHigh = Math.round(daily.temperature_2m_max[0]);
  const todayLow = Math.round(daily.temperature_2m_min[0]);
  document.getElementById('weather-high-low').textContent = `H: ${todayHigh}°  L: ${todayLow}°`;
  
  // Update dynamic background and dashboard status dot
  updateDynamicTheme(current.weather_code, current.is_day);

  // Render hourly list
  renderHourlyForecast(hourly, data.timezone);
  
  // Render daily list
  renderDailyForecast(daily);
  
  // Render widgets
  renderWidgets(current, daily, data.timezone);
}

// Update background colors dynamically based on weather conditions
function updateDynamicTheme(code, isDay) {
  let gradient = 'linear-gradient(135deg, #4fa2ff 0%, #1c52b0 100%)'; // default sunny day
  let themeDotColor = '#27c93f'; // green active
  
  const isNight = isDay === 0;
  
  if (isNight) {
    themeDotColor = '#5c5cff';
    if (code === 0 || code === 1) {
      gradient = 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)'; // clear night
    } else if (code === 2 || code === 3) {
      gradient = 'linear-gradient(135deg, #1e293b 0%, #334155 100%)'; // cloudy night
    } else if (code >= 51 && code <= 67 || code >= 80 && code <= 82) {
      gradient = 'linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%)'; // rainy night
    } else if (code >= 71 && code <= 77 || code >= 85 && code <= 86) {
      gradient = 'linear-gradient(135deg, #1e293b 0%, #475569 100%)'; // snowy night
    } else if (code >= 95) {
      gradient = 'linear-gradient(135deg, #090d16 0%, #1e1b4b 100%)'; // storm night
    } else {
      gradient = 'linear-gradient(135deg, #0b0f19 0%, #1a2238 100%)'; // general night
    }
  } else {
    // Daytime
    if (code === 0 || code === 1) {
      gradient = 'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)'; // clear day
      themeDotColor = '#f5af19'; // amber sun
    } else if (code === 2 || code === 3) {
      gradient = 'linear-gradient(135deg, #94a3b8 0%, #475569 100%)'; // cloudy day
      themeDotColor = '#cbd5e1';
    } else if (code >= 51 && code <= 67 || code >= 80 && code <= 82) {
      gradient = 'linear-gradient(135deg, #475569 0%, #2563eb 100%)'; // rainy day
      themeDotColor = '#60a5fa';
    } else if (code >= 71 && code <= 77 || code >= 85 && code <= 86) {
      gradient = 'linear-gradient(135deg, #cbd5e1 0%, #64748b 100%)'; // snowy day
      themeDotColor = '#e2e8f0';
    } else if (code >= 95) {
      gradient = 'linear-gradient(135deg, #1e293b 0%, #312e81 100%)'; // storm day
      themeDotColor = '#a855f7';
    }
  }
  
  document.body.style.background = gradient;
  
  const dot = document.querySelector('.theme-dot');
  if (dot) {
    dot.style.backgroundColor = themeDotColor;
    dot.style.boxShadow = `0 0 10px ${themeDotColor}`;
  }
}

// Render horizontal hourly scroll list
function renderHourlyForecast(hourly, timezone) {
  const container = document.getElementById('hourly-list');
  container.innerHTML = '';
  
  const now = new Date();
  
  // Find current hour index or start from element 0
  let startIndex = 0;
  try {
    const options = { hour: 'numeric', timeZone: timezone };
    const currentHourStr = now.toLocaleTimeString('en-US', options);
    
    for (let i = 0; i < hourly.time.length; i++) {
      const hrDate = new Date(hourly.time[i]);
      const hrStr = hrDate.toLocaleTimeString('en-US', { hour: 'numeric', timeZone: timezone });
      if (hrStr === currentHourStr) {
        startIndex = i;
        break;
      }
    }
  } catch (e) {
    console.error('Error finding start index:', e);
  }
  
  // Render next 24 hours
  for (let i = startIndex; i < Math.min(startIndex + 24, hourly.time.length); i++) {
    const isCurrent = i === startIndex;
    const hourDate = new Date(hourly.time[i]);
    
    let hourDisplay = hourDate.toLocaleTimeString('en-US', { hour: 'numeric', timeZone: timezone });
    if (isCurrent) hourDisplay = 'Now';
    
    const temp = Math.round(hourly.temperature_2m[i]);
    const code = hourly.weather_code[i];
    const isDay = hourly.is_day[i];
    
    // Rain probability if available
    const precipProb = hourly.precipitation_probability ? hourly.precipitation_probability[i] : 0;
    const precipDisplay = precipProb > 0 ? `${precipProb}%` : '';
    
    const item = document.createElement('div');
    item.className = `hourly-item ${isCurrent ? 'now' : ''}`;
    
    item.innerHTML = `
      <span class="hourly-time">${hourDisplay}</span>
      <span class="hourly-precip">${precipDisplay}</span>
      ${getWeatherIconSVG(code, isDay, 'hourly-icon-svg')}
      <span class="hourly-temp">${temp}°</span>
    `;
    
    container.appendChild(item);
  }
}

// Render weekly forecast with macOS-style progress bars
function renderDailyForecast(daily) {
  const container = document.getElementById('daily-list');
  container.innerHTML = '';
  
  // Calculate absolute range of temperature across all 10 days
  const allMaxTemps = daily.temperature_2m_max;
  const allMinTemps = daily.temperature_2m_min;
  
  const absMax = Math.max(...allMaxTemps);
  const absMin = Math.min(...allMinTemps);
  const totalRange = absMax - absMin;
  
  for (let i = 0; i < daily.time.length; i++) {
    const isToday = i === 0;
    const date = new Date(daily.time[i]);
    
    let dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
    if (isToday) dayName = 'Today';
    
    const code = daily.weather_code[i];
    const low = Math.round(daily.temperature_2m_min[i]);
    const high = Math.round(daily.temperature_2m_max[i]);
    
    // Calculate percentage coordinates for temperature bar fill
    const leftPercent = totalRange > 0 ? ((low - absMin) / totalRange) * 100 : 0;
    const widthPercent = totalRange > 0 ? ((high - low) / totalRange) * 100 : 100;
    
    // If today, calculate exact placement of current temperature dot
    let dotPlacementHTML = '';
    if (isToday) {
      const currentTempStr = document.getElementById('weather-temp').textContent;
      const currentTemp = parseInt(currentTempStr) || low;
      
      // Cap within range
      const cappedTemp = Math.max(low, Math.min(high, currentTemp));
      const dotPercent = totalRange > 0 ? ((cappedTemp - absMin) / totalRange) * 100 : 50;
      dotPlacementHTML = `<span class="temp-bar-dot" style="left: ${dotPercent}%;"></span>`;
    }
    
    const row = document.createElement('div');
    row.className = 'daily-row';
    
    row.innerHTML = `
      <span class="daily-day ${isToday ? 'today' : ''}">${dayName}</span>
      ${getWeatherIconSVG(code, 1, 'daily-icon-svg')}
      <span class="daily-temp-low">${low}°</span>
      <div class="temp-bar-container">
        <div class="temp-bar-bg">
          <div class="temp-bar-fill" style="left: ${leftPercent}%; width: ${widthPercent}%;"></div>
          ${dotPlacementHTML}
        </div>
      </div>
      <span class="daily-temp-high">${high}°</span>
    `;
    
    container.appendChild(row);
  }
}

// Render widgets detailing UV, Wind, Sunrise/Sunset, Humidity
function renderWidgets(current, daily, timezone) {
  // 1. UV Index
  const todayUV = Math.round(daily.uv_index_max[0]);
  document.getElementById('uv-value').textContent = todayUV;
  
  let uvDesc = 'Low';
  let uvPercentage = (todayUV / 12) * 100; // max scale 12
  uvPercentage = Math.min(100, Math.max(0, uvPercentage));
  
  if (todayUV >= 3 && todayUV <= 5) uvDesc = 'Moderate';
  else if (todayUV >= 6 && todayUV <= 7) uvDesc = 'High';
  else if (todayUV >= 8 && todayUV <= 10) uvDesc = 'Very High';
  else if (todayUV >= 11) uvDesc = 'Extreme';
  
  document.getElementById('uv-desc').textContent = `${uvDesc} for the day`;
  document.getElementById('uv-indicator').style.left = `${uvPercentage}%`;
  
  // 2. Wind Direction and Speed
  const speed = Math.round(current.wind_speed_10m);
  const direction = current.wind_direction_10m || 0;
  
  document.getElementById('wind-value').innerHTML = `${speed} <span class="unit">km/h</span>`;
  document.getElementById('wind-dir-desc').textContent = getWindDirectionCompass(direction);
  document.getElementById('wind-needle').style.transform = `translateX(-50%) rotate(${direction}deg)`;
  
  // 3. Sunrise & Sunset
  const sunriseStr = daily.sunrise[0];
  const sunsetStr = daily.sunset[0];
  
  const options = { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: timezone };
  const sunriseDate = new Date(sunriseStr);
  const sunsetDate = new Date(sunsetStr);
  
  document.getElementById('sunrise-time').textContent = sunriseDate.toLocaleTimeString('en-US', options);
  document.getElementById('sunset-time').textContent = sunsetDate.toLocaleTimeString('en-US', options);
  
  // Calculate sun arc progress
  const now = new Date();
  let progress = 0; // 0 to 1
  
  if (now > sunsetDate) {
    progress = 1;
  } else if (now < sunriseDate) {
    progress = 0;
  } else {
    progress = (now - sunriseDate) / (sunsetDate - sunriseDate);
  }
  
  // Update path dashoffset
  const pathLength = 140; // Approx path length
  const strokeOffset = pathLength - (pathLength * progress);
  document.getElementById('sun-progress-arc').style.strokeDashoffset = strokeOffset;
  
  // Update sun dot coordinates along the arc path d="M5,45 Q50,5 95,45"
  // Quadratic Bezier: B(t) = (1-t)^2*P0 + 2*(1-t)*t*P1 + t^2*P2
  const t = progress;
  const p0 = { x: 5, y: 45 };
  const p1 = { x: 50, y: 5 };
  const p2 = { x: 95, y: 45 };
  
  const sunX = Math.round(Math.pow(1 - t, 2) * p0.x + 2 * (1 - t) * t * p1.x + Math.pow(t, 2) * p2.x);
  const sunY = Math.round(Math.pow(1 - t, 2) * p0.y + 2 * (1 - t) * t * p1.y + Math.pow(t, 2) * p2.y);
  
  const sunDot = document.getElementById('sun-indicator-dot');
  sunDot.setAttribute('cx', sunX);
  sunDot.setAttribute('cy', sunY);
  
  // 4. Humidity & Feels Like
  const humidity = Math.round(current.relative_humidity_2m || 0);
  const feelsLike = Math.round(current.apparent_temperature);
  
  document.getElementById('humidity-value').textContent = `${humidity}%`;
  document.getElementById('feels-like-value').textContent = `${feelsLike}°`;
  
  // Calculate dew point estimate
  // Td = T - ((100 - RH)/5)
  const tempCurrentStr = document.getElementById('weather-temp').textContent;
  const tempCurrent = parseInt(tempCurrentStr) || 20;
  const dewPoint = Math.round(tempCurrent - ((100 - humidity) / 5));
  document.getElementById('humidity-desc').textContent = `The dew point is ${dewPoint}° right now.`;
}

// Convert wind direction degrees to compass string
function getWindDirectionCompass(deg) {
  const idx = Math.round((deg % 360) / 45) % 8;
  const compassDirections = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return compassDirections[idx];
}

// Return human weather description mapping for WMO codes
function getWeatherDescription(code) {
  const wmoCodes = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snowfall',
    73: 'Moderate snowfall',
    75: 'Heavy snowfall',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail'
  };
  return wmoCodes[code] || 'Unknown conditions';
}

// Return beautifully-crafted inline weather SVG markup based on weather code and is_day
function getWeatherIconSVG(code, isDay, className = 'weather-icon') {
  const isNight = isDay === 0;
  
  // Clear Sky
  if (code === 0) {
    if (isNight) {
      return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="#f1f5f9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
    }
    return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="#f5af19" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
  }
  
  // Mainly clear / partly cloudy
  if (code === 1 || code === 2) {
    if (isNight) {
      return `
        <svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a15.3 15.3 0 0 1 4 7 15.3 15.3 0 0 1-4 7 15.3 15.3 0 0 1-4-7 15.3 15.3 0 0 1 4-7z" stroke="#f1f5f9" opacity="0.6"/>
          <path d="M18 10a5 5 0 0 1 4 4.5 4.5 4.5 0 0 1-4.5 4.5H9a5 5 0 0 1-5-5 5 5 0 0 1 5-5h.5A5.5 5.5 0 0 1 18 10z"/>
        </svg>
      `;
    }
    return `
      <svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="9" cy="9" r="4" stroke="#f5af19" fill="#f5af19" opacity="0.3"/>
        <line x1="9" y1="2" x2="9" y2="4" stroke="#f5af19"/>
        <line x1="14" y1="4" x2="12.6" y2="5.4" stroke="#f5af19"/>
        <line x1="16" y1="9" x2="14" y2="9" stroke="#f5af19"/>
        <path d="M18 10a5 5 0 0 1 4 4.5 4.5 4.5 0 0 1-4.5 4.5H9a5 5 0 0 1-5-5 5 5 0 0 1 5-5h.5A5.5 5.5 0 0 1 18 10z" fill="rgba(255,255,255,0.2)"/>
      </svg>
    `;
  }
  
  // Overcast
  if (code === 3) {
    return `
      <svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="#e2e8f0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 10a5 5 0 0 1 4 4.5 4.5 4.5 0 0 1-4.5 4.5H9a5 5 0 0 1-5-5 5 5 0 0 1 5-5h.5A5.5 5.5 0 0 1 18 10z" fill="rgba(255,255,255,0.15)"/>
        <path d="M15 6a4 4 0 0 0-4-3.5 3.5 3.5 0 0 0-3.5 3.5H7.5A4.5 4.5 0 0 0 3 10.5 4.5 4.5 0 0 0 7.5 15h9.5a4 4 0 0 0 4-4 4 4 0 0 0-4-4h-2z" opacity="0.7"/>
      </svg>
    `;
  }
  
  // Fog
  if (code === 45 || code === 48) {
    return `
      <svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="5" y1="9" x2="19" y2="9" />
        <line x1="3" y1="13" x2="21" y2="13" />
        <line x1="6" y1="17" x2="18" y2="17" />
        <line x1="8" y1="5" x2="16" y2="5" opacity="0.5"/>
      </svg>
    `;
  }
  
  // Drizzle / Rain
  if (code >= 51 && code <= 67 || code >= 80 && code <= 82) {
    return `
      <svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 10a5 5 0 0 1 4 4.5 4.5 4.5 0 0 1-4.5 4.5H9a5 5 0 0 1-5-5 5 5 0 0 1 5-5h.5A5.5 5.5 0 0 1 18 10z" stroke="#e2e8f0" fill="rgba(255,255,255,0.1)"/>
        <line x1="8" y1="21" x2="8" y2="23" stroke-width="1.5"/>
        <line x1="12" y1="21" x2="12" y2="23" stroke-width="1.5"/>
        <line x1="16" y1="21" x2="16" y2="23" stroke-width="1.5"/>
      </svg>
    `;
  }
  
  // Snow
  if (code >= 71 && code <= 77 || code >= 85 && code <= 86) {
    return `
      <svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 10a5 5 0 0 1 4 4.5 4.5 4.5 0 0 1-4.5 4.5H9a5 5 0 0 1-5-5 5 5 0 0 1 5-5h.5A5.5 5.5 0 0 1 18 10z" stroke="#e2e8f0"/>
        <circle cx="8" cy="21" r="1" fill="#ffffff" stroke="none"/>
        <circle cx="12" cy="22" r="1.2" fill="#ffffff" stroke="none"/>
        <circle cx="16" cy="20" r="1" fill="#ffffff" stroke="none"/>
      </svg>
    `;
  }
  
  // Thunderstorm
  if (code >= 95) {
    return `
      <svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 16.9A5 5 0 0 0 18 10h-1.26a8 8 0 1 0-11.62 8.58" stroke="#94a3b8"/>
        <polyline points="13 14 9 18 12 18 10 22" />
      </svg>
    `;
  }
  
  // Default cloud/sun
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle></svg>`;
}

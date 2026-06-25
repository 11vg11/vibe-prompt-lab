# 🍏 macOS Weather App

> A fast, fluid, and beautifully designed weather application styled after the macOS Weather widget design system, built as a project for **Vibe Coding** practice! 🌊✨

[![Vibe Coding](https://img.shields.io/badge/Coding_Style-Vibe_Coding-ff69b4?style=for-the-badge&logo=visual-studio-code)](https://github.com)
[![Platform](https://img.shields.io/badge/Platform-Web_/_macOS_Style-1f2937?style=for-the-badge&logo=apple)](https://github.com)
[![Backend](https://img.shields.io/badge/Backend-Express.js-000000?style=for-the-badge&logo=express)](https://expressjs.com)
[![API](https://img.shields.io/badge/Weather_API-Open--Meteo-4fa2ff?style=for-the-badge)](https://open-meteo.com/)

---

## 🌊 Vibe Coding Disclaimer

This project is an **example built purely for practice**. The code was crafted in a relaxed "vibe coding" state—focusing on fluid aesthetics, satisfying micro-animations, glassmorphism, and instant feedback. It demonstrates integration of local storage, API proxies, dynamic rendering, and native Web technologies.

---

## ✨ Features

- **🍏 macOS Glassmorphic Design**: Clean blur effects (`backdrop-filter`), thin borders, traffic light window controls, and standard macOS layouts.
- **🌈 Dynamic Gradients**: Visual themes (gradients) change smoothly based on the current weather condition and local day/night status of the selected location.
- **🔍 Fast City Search**: Live search geocoding proxy powered by the Open-Meteo Geocoding API.
- **📈 macOS-Style Temperature Bars**: The 10-day forecast displays temperature range bars showing the relative range of min/max temperatures, with current temperature dots (just like native macOS).
- **☀️ Interactive Solar Arc**: Visualizes sunrise/sunset progress with a smooth quadratic Bezier curve indicating the exact height of the sun based on local time.
- **🧭 Compass Wind Widget**: Live wind speed representation with a rotating compass needle.
- **💾 LocalStorage Caching**: Remembers your saved locations list so they load instantly on repeat visits.

---

## 🛠️ Tech Stack

- **Backend**: Node.js & Express (provides endpoints to avoid CORS limits and proxy weather forecasts).
- **Frontend**: Pure HTML5, CSS3 Custom Properties (variables), and Vanilla JavaScript (ES modules).
- **API**: Open-Meteo (Zero setup, high-fidelity data, completely free, no API keys required!).

---

## 🚀 Getting Started

### Prerequisites

Make sure you have [Node.js](https://nodejs.org/) installed (version 18+ recommended for native fetch support).

### Installation

1. Clone or copy this repository directory:
   ```bash
   cd Weather_app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Launch the development server:
   ```bash
   npm run dev
   ```
   *(Alternatively, run `npm start`)*

4. Open your browser and navigate to:
   **[http://localhost:3000](http://localhost:3000)**

---

## 🎨 Aesthetic Customizations

- The layout is optimized to look like a desktop application.
- The fonts load Google's `Inter` typeface for maximum clarity, falling back to system-ui fonts (like SF Pro on macOS).
- Animations run with hardware-accelerated CSS `transform` and `opacity` properties.

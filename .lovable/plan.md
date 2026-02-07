

# 📚 Reading Copilot — AI-Powered Book Recommendation App

## Overview
A publicly accessible, demo-ready website where individual readers manage a personal book library and interact with an AI-powered Reading Copilot that delivers personalized, explainable book recommendations. The entire UI transforms visually based on the user's selected genre theme.

---

## 🏗️ Architecture

**Frontend:** React + Tailwind CSS with genre-based CSS theming  
**Backend:** Lovable Cloud (Supabase) for data persistence + Lovable AI for recommendations  
**Data:** All user data (library, feedback, preferences, theme) stored in the database, identified by a browser-generated anonymous session ID stored in localStorage  
**AI:** Lovable AI Gateway (streaming chat) powering the Reading Copilot

---

## 📄 Pages & Features

### 1. Landing Page — Rich & Immersive
- **Hero section** with an engaging headline ("Your AI Reading Companion") and a brief tagline about personalized book discovery
- **How It Works** section: 3-step visual flow — Add Books → Chat with Copilot → Get Personalized Picks
- **Feature highlights**: Adaptive theming, transparent AI reasoning, feedback-driven learning
- **Genre theme preview strip** showing the 5 available visual themes as clickable cards
- **Call-to-action** button leading to the Copilot experience
- Subtle animations on scroll for demo polish

### 2. Library Management Page
- **Add books manually** via a form: title, author, genre (optional), reading status (Want to Read / Currently Reading / Finished / Abandoned)
- **Library view** as a card grid showing all books with status badges
- **Inline editing** — click a book card to update status or details
- **Delete** books with confirmation
- **Empty state** with helpful prompts and a "seed library" option that pre-populates a few sample books for demo purposes
- Search/filter by status or keyword

### 3. Reading Copilot Chat Page — ⭐ Primary Feature
- **Chat-style interface** with streaming AI responses rendered in markdown
- **Suggested prompts** to get started: "What should I read next?", "I want something short and light", "Surprise me with something different"
- AI recommendations appear as **styled recommendation cards** within the chat, each showing:
  - Book title & author
  - A clear explanation of *why* this book fits the user
  - **Accept** (👍) / **Reject** (👎) feedback buttons
- Feedback is stored and referenced in subsequent AI interactions — the AI explicitly mentions past accepts/rejects
- The AI's system prompt includes the full library context, reading preferences, and feedback history
- Conversation history persists within a session

### 4. Preferences Page
- **Genre Theme Selector** — visual picker showing 5 genre themes as styled cards with preview colors. Selection persists in the database and applies site-wide immediately
- **Reading Preferences** section — editable text fields for preferences that the AI infers (e.g., "You seem to prefer fast-paced narratives under 300 pages"). Users can edit or add their own preferences
- **Feedback History** — summary view of past accept/reject decisions with the ability to reverse a decision

---

## 🎨 Genre Theming System (CSS-Only, Inspired by Reference Images)

Each theme changes the **color palette**, **typography feel**, and **subtle CSS visual motifs** (gradients, borders, shadows) across the entire app. No background images — pure CSS styling.

### Fantasy
*Inspired by: enchanted forest, candlelight, mossy stone*
- **Colors:** Deep emerald greens, warm amber/gold accents, dark mossy backgrounds
- **Typography:** Slightly serif headings with an elegant, storybook feel
- **Motifs:** Subtle golden glow effects on cards, soft vignette shadows, organic rounded shapes

### Science Fiction
*Inspired by: space station, cold blue light, vast technology*
- **Colors:** Deep navy/black base, electric blue and cyan accents, cool metallic silvers
- **Typography:** Clean, geometric sans-serif with a technical feel
- **Motifs:** Subtle grid lines, glowing border accents, sharp geometric card shapes

### History
*Inspired by: antique maps, globes, aged paper, warm wood tones*
- **Colors:** Warm sepia, parchment cream backgrounds, burnt umber and antique brass accents
- **Typography:** Classical serif fonts with an academic, timeless quality
- **Motifs:** Subtle paper texture via CSS gradients, vintage-style card borders, warm shadow tones

### Romance
*Inspired by: Parisian silhouettes, garden arches, soft watercolor florals*
- **Colors:** Soft blush pinks, dusty rose, warm ivory, touches of gold
- **Typography:** Elegant, flowing serif with gentle letter-spacing
- **Motifs:** Soft gradient overlays, delicate border curves, warm rosy glows on hover

### Thriller
*Inspired by: evidence boards, dark rooms, scattered documents*
- **Colors:** Near-black backgrounds, harsh white/cream text, blood red accents
- **Typography:** Bold, condensed sans-serif with urgency — slightly rough/gritty feel
- **Motifs:** High-contrast card styles, sharp edges, subtle red accent lines, dramatic shadows

A **default neutral theme** applies before the user makes a selection.

---

## 🤖 AI Behavior & Design

- **System prompt** includes: the user's full book library, reading status of each book, any stated preferences, and the complete accept/reject feedback log
- The AI is instructed to:
  - Return 1–3 book recommendations per response
  - Explain *why* each book fits based on the user's library and feedback patterns
  - Reference specific past feedback (e.g., "Since you rejected thrillers last time, here's something lighter…")
  - Stay conversational and helpful, not robotic
- **Human-in-the-loop**: The AI proposes, the user decides via accept/reject buttons
- Streaming responses for a responsive, engaging feel

---

## 🗄️ Database Design

- **Sessions** — anonymous session tracking (auto-generated ID)
- **Books** — user's personal library (title, author, genre, status, linked to session)
- **Feedback** — accept/reject log for AI recommendations (book title, action, timestamp, linked to session)
- **Preferences** — user's reading preferences and selected theme (linked to session)

---

## 🧭 Navigation

- Persistent top navigation bar with links to: **Home**, **My Library**, **Copilot**, **Preferences**
- Navigation styling adapts to the active genre theme
- Mobile-responsive with a hamburger menu

---

## 🎯 Implementation Priority

1. **Theme system foundation** — CSS variable-based theming with all 5 genre themes + default
2. **Landing page** — rich, immersive, sets the tone
3. **Library management** — CRUD for books with database persistence
4. **Preferences page** — theme selector + editable preferences
5. **Reading Copilot chat** — streaming AI chat with recommendation cards and accept/reject feedback
6. **Connect the loop** — feedback influences future AI suggestions, preferences page shows AI-inferred insights


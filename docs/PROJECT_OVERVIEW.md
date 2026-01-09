# ESL Pipeline – Project Explainer

> **TL;DR:** ESL Pipeline automates the tedious work between teaching a lesson and delivering polished homework to students. Record → Transcribe → Generate → Publish, all in one flow.

---

## What Is This?

ESL Pipeline is a **lesson-to-homework automation system** for private English tutors. It takes a lesson recording and transforms it into a complete, personalized homework assignment published to Notion—with professional text-to-speech audio included.

## If You’re a Maintainer

Recommended reading order:
1. `docs/README.md` (documentation index)
2. `docs/reference/agents-ssot.md` (contracts and invariants)
3. `docs/backend-frontend/backend-frontend-alignment.md` (API status + dependencies)
4. `docs/design/FRONTEND_VISION_V2.md` (target frontend experience)

---

## Who Is It For?

**Primary User: The Solo Private ESL Tutor**

A tutor who:
- Teaches 1-on-1 adult English learners
- Wants each homework to be personalized to what happened *in that specific lesson*
- Currently spends 30-60 minutes per student manually creating homework
- Juggles multiple students at different levels (A1→C1)
- Uses Notion (or similar) to deliver homework to students

**Example persona:** A tutor with 8 regular students, each meeting weekly. That's 8 personalized homework assignments to create every week—4-8 hours of administrative work that directly competes with teaching time.

---

## What Problems Does It Solve?

### 1. 🕐 **Time Sink: Manual Homework Creation**
> *"I spend almost as much time creating homework as I do teaching."*

Each lesson requires: reviewing what was covered, writing exercises targeting the student's weak points, creating example dialogues, formatting everything nicely. **ESL Pipeline reduces 30+ minutes of work to ~5 minutes of review.**

### 2. 🎯 **Personalization at Scale**
> *"Generic textbook exercises don't address what MY student struggles with."*

The system pulls from the student's **profile** (their goals, persistent errors, vocabulary log, learning history) and the **lesson transcript** (what actually happened today). The LLM generates homework that directly addresses "Irina still says 'he want' instead of 'he wants'" — not generic grammar drills.

### 3. 🎙️ **Audio Content is Expensive**
> *"I can't afford to hire voice actors for every homework."*

Professional TTS via ElevenLabs creates natural-sounding dialogues and listening exercises. The system handles multi-speaker dialogues with appropriate voices based on the content's speaker profiles.

### 4. 📋 **Inconsistent Quality**
> *"Some weeks I'm inspired, other weeks I'm rushing and the homework suffers."*

The LLM follows a strict, pedagogically-sound template (the "Homework Output Template") ensuring every assignment has: mission briefing, study text, grammar toolkit, practice exercises, pronunciation focus, answer key, and teacher's follow-up plan.

### 5. 🔄 **No Record of What Was Done**
> *"Which grammar points have I covered with Maria? What did we do 3 lessons ago?"*

The system maintains manifests (job records) and student profiles that accumulate over time, creating an institutional memory of each student's learning journey.

---

## How Does It Work?

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. RECORD       │ Tutor records lesson (Windows/Mac, any recorder) │
├─────────────────────────────────────────────────────────────────────┤
│ 2. TRANSCRIBE   │ Deepgram ASR converts audio → text               │
├─────────────────────────────────────────────────────────────────────┤
│ 3. ASSEMBLE     │ Prompt = Template + Student Profile + Transcript │
├─────────────────────────────────────────────────────────────────────┤
│ 4. GENERATE     │ LLM creates homework markdown (GPT/Claude/etc.)  │
├─────────────────────────────────────────────────────────────────────┤
│ 5. REVIEW       │ Tutor reviews, makes minor edits if needed       │
├─────────────────────────────────────────────────────────────────────┤
│ 6. PUBLISH      │ Pipeline runs: Validate → Notion → TTS → Upload  │
└─────────────────────────────────────────────────────────────────────┘
```

**The "Pipeline" part:**
- **Validate** the markdown structure
- **Import** to Notion (create page, format blocks, apply colors)
- **Generate TTS** audio for the study text dialogue/monologue
- **Upload** audio to S3
- **Attach** audio to the Notion page
- **Save** a manifest for reruns and history

---

## Tech Stack (Quick Overview)

| Layer | Technology |
|-------|------------|
| Frontend | React + Vite |
| Backend | Fastify + BullMQ + PostgreSQL |
| Transcription | Deepgram |
| LLM | OpenAI / Claude / Gemini (user's choice) |
| TTS | ElevenLabs |
| Storage | AWS S3 |
| Publishing | Notion API |
| Orchestration | Node.js monorepo (`@esl-pipeline/*` packages) |

---

## What Makes This Different?

| Approach | ESL Pipeline |
|----------|--------------|
| **Generic homework generators** | Uses *actual lesson content* + *student's learning history* |
| **Manual tutoring workflow** | Automates the boring parts, keeps tutor in control of content |
| **One-size-fits-all exercises** | Every assignment is personalized to that student, that lesson |
| **Text-only homework** | Includes natural TTS audio (dialogue/monologue) |
| **Scattered tools** | Unified pipeline: record → review → publish |

---

## Current State vs. End Vision

| Aspect | Now | End Goal |
|--------|-----|----------|
| LLM integration | Manual (copy-paste to web UI) | Direct API call, one-click |
| Transcription | Separate CLI tool | Integrated in web UI |
| Student profiles | JSON files | Full CRUD in UI |
| Analytics | None | Usage tracking, progress viz |
| Publishing | Notion only | Notion + AppFlowy option |

---

## The Core Value Proposition

> **"Teach the lesson. We'll handle the homework."**

ESL Pipeline lets tutors focus on what they're good at—teaching—by automating the repetitive, time-consuming work of creating personalized, high-quality homework with audio. It's not about replacing the tutor's expertise; it's about amplifying it.

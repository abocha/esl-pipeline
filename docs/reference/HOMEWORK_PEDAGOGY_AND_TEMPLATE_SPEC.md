# Homework Pedagogy and Template Spec

## Meta

- Audience: founder, maintainers, prompt/runtime implementers, AI agents.
- Read Time: 8 minutes.
- Authority Level: canonical pedagogy and assignment-template reference for `general-english` v1.
- Last Verified Against: 2026-03-20 repo state.
- Owner: founder-maintainer + backend/frontend maintainers.
- Review Cadence: monthly or after meaningful homework-template changes.
- Status: `reference`.

## Purpose

- Preserve the pedagogical core of the homework system independently from provider/runtime prompt
  wording.
- Make the battle-tested assignment structure legible to future implementers before memory-system
  changes reshape prompt assembly.
- Define what should remain stable even as prompt text, memory packaging, and provider tuning evolve.

## Baseline

This spec is intentionally based very closely on the protected pedagogical baseline snapshot:

- [`docs/templates/hw_prompt_v4-4_voice-aligned.md`](../templates/hw_prompt_v4-4_voice-aligned.md)

That template is the canonical pedagogical reference for the homework method. The current
memory-aware runtime snapshot may evolve in a newer prompt file, but this doc exists to explain
which pedagogical moves in `v4.4` are deliberate, protected, and worth preserving as the system
evolves.

## Relationship to Other Docs

- Use this doc for pedagogy, assignment anatomy, and continuity intent.
- Use [`docs/reference/PRESET_V2_SPEC.md`](PRESET_V2_SPEC.md) for preset architecture and prompt
  governance.
- Use [`docs/plans/student-memory-system-upgrade/phase-5-prompt-template-and-provider-runtime.md`](../plans/student-memory-system-upgrade/phase-5-prompt-template-and-provider-runtime.md)
  for memory-aware prompt assembly/runtime behavior.
- Use the template file itself for exact output wording and syntax requirements.

## Locked Decisions

1. The `v4.4` voice-aligned homework shape is the canonical pedagogical baseline for
   `general-english` version 1.
2. Prompt wording may evolve, but the assignment's pedagogical spine should not be casually
   re-invented.
3. One homework should feel like one coherent mission, not a loose bundle of unrelated exercises.
4. The assignment should revolve around one primary input source and reuse it across downstream
   sections to keep cognitive load low.
5. Homework should balance:
   - immediate relevance to the current lesson
   - continuity from prior work
   - a manageable amount of novelty
6. The assignment must remain personalized, but personalization must serve learning outcomes rather
   than decorative customization.
7. Pronunciation work should remain a small, focused, low-friction intervention rather than a large
   parallel curriculum.
8. The teacher follow-up plan is part of the product method, not an accidental appendix.
9. The memory-system upgrade should strengthen continuity and targeting, not replace the template's
   teaching philosophy.

## Core Pedagogical Model

The assignment method embodied by `v4.4` follows this teaching loop:

1. orient the student with one clear mission
2. reduce overwhelm with a visible workload path
3. ground the week in one coherent input source
4. extract useful language from that source
5. move from controlled practice to limited production
6. include one small pronunciation intervention
7. end with a communicative mission that feels purposeful
8. explain why this week matters for this specific student
9. leave both the student and the teacher with clean next-step guidance

This loop is the real product. The prompt and formatting exist to deliver it consistently.

Runtime note:

- `v4.4` remains the protected pedagogical baseline reference.
- The current stateless memory-aware runtime snapshot may evolve in a newer prompt file, but it
  should remain a faithful operational expression of the same teaching method rather than a new
  pedagogy.

## Section-by-Section Assignment Contract

The headings below intentionally mirror the current template. Future prompt revisions should treat
this structure as the default contract unless a later decision doc explicitly changes it.

### 1. `## 1. 🎯 This Week's Mission Briefing`

Purpose:

- frame the week as one achievable communicative goal
- make the student feel oriented immediately
- connect the week's work to useful language, not abstract grammar labels alone

Protected invariants:

- this section should name one clear outcome the student can accomplish
- it should preview the key language focus in learner-friendly terms
- it should feel motivating and concrete, not academic or bloated

Allowed evolution:

- tone, phrasing, and surface style may evolve
- the exact wording of the mission may become more memory-aware
- the section should still remain short and confidence-building

### 2. `## 2. 🗺️ Your Homework Roadmap`

Purpose:

- lower resistance by making the workload feel navigable
- give the student agency over time and energy
- keep the assignment usable even in a busy week

Protected invariants:

- the roadmap should offer a default full path plus lighter/heavier options
- the default path should remain the recommended one
- the roadmap should help the student decide how much to do without feeling they have failed if
  they choose a lighter path

Allowed evolution:

- estimated times may be tuned
- labels such as `Light`, `Default`, and `Plus` may evolve if a better student-facing language
  emerges
- the roadmap should still stay simple and fast to scan

### 3. `## 3. 🎧 Input Material: The Source`

Purpose:

- give the assignment one coherent linguistic center
- provide the raw material that later grammar, vocabulary, comprehension, and pronunciation work
  will reuse
- keep cognitive load low by avoiding unnecessary source-switching

Protected invariants:

- there is one primary study source per assignment
- the same source should anchor later sections whenever possible
- both `authentic` and `generate` paths are valid, but each should still feel like a meaningful
  source rather than filler
- the source should be chosen or generated to fit the student's current level and lesson trajectory

Important note:

- The single-source reuse policy is not just a formatting preference. It is a pedagogical device for
  coherence and retention.

Allowed evolution:

- the balance between authentic and generated inputs may evolve
- the exact study-text length may evolve
- future systems may enrich source selection with memory and retrieval
- the assignment should still center one primary source rather than fragment into unrelated texts

### 4. `## 4. 🛠️ Language Toolkit: Useful Language`

Purpose:

- help the student notice useful grammar and chunks inside meaningful context
- turn the source into reusable language, not passive reading/listening material

#### `### A. 👀 Notice the Grammar`

Purpose:

- surface one main grammar focus in context, with room for a few smaller supporting points when
  they genuinely matter
- explain form, meaning, and use in a practical way
- help the student notice choices speakers make, not memorize abstract rules in isolation

Protected invariants:

- there should usually be one clearly dominant grammar focus
- smaller supporting points may be included when they come directly from the lesson and help the
  student remember an important nuance, contrast, or teacher explanation
- examples should come from the source text when possible
- explanation should remain learner-friendly and function-oriented
- grammar focus should be narrow enough to support later practice
- not every mentioned nuance needs heavy downstream practice, but important smaller points may earn
  a brief reminder or one targeted exercise item

Creativity rule:

- the model should have room to explain grammar in unusually clear, elegant, or memorable ways
- guardrails should protect coherence and usefulness, not flatten good teaching
- the goal is disciplined flexibility, not rigid one-size-fits-all explanation style

#### `### B. 🗣️ Useful Chunks & Vocabulary`

Purpose:

- build a mini-lexicon of genuinely usable items
- favor chunks, collocations, and helpful expressions over random word lists
- support both comprehension and later production

Protected invariants:

- items should be contextualized and learner-friendly
- the list should feel curated, not exhaustive
- the chosen language should contribute to the final mission, not distract from it

Allowed evolution for Section 4:

- layout may change
- number of vocabulary items may be tuned
- the exact mix of grammar versus vocabulary emphasis may adapt to the lesson
- the section should still feel like a compact toolkit extracted from the source

### 5. `## 5. ✍️ Practice & Pronunciation`

Purpose:

- move from noticing to action
- reinforce the current lesson while carrying forward selected review targets
- keep pronunciation work concrete and lightweight

#### `### A. 🔩 Controlled Practice`

Purpose:

- give the student a safe place to practice target forms
- correct likely mistakes before freer production
- revisit selected review items without making the whole homework feel repetitive

Protected invariants:

- controlled practice should be directly tied to the week's focus
- it should include targeted correction of relevant learner errors
- some items should revisit recent homework or recurring issues when that review is truly warranted
- review should be explicit and bounded, not a hidden accumulation of old material

#### `### B. 🤔 Comprehension Check`

Purpose:

- confirm the student understood the source
- keep the source meaningful rather than decorative

Protected invariants:

- questions should check main ideas, not trivia
- comprehension should remain short because it supports the larger assignment rather than becoming
  the assignment

#### `### C. 🎙️ Pronunciation Micro-Focus`

Purpose:

- provide one small but high-value pronunciation intervention
- keep speaking work tangible and recordable
- help the student notice a specific sound, rhythm, stress, or intonation target

Protected invariants:

- pronunciation should stay micro, not become a second curriculum
- there should be one clear target and one concrete action
- the task should feel doable in about a minute of focused practice
- the deliverable should remain lightweight, such as a short voice note

Allowed evolution for Section 5:

- exact exercise types may evolve
- the review/load balance may evolve
- pronunciation mode inventory may evolve
- the section should still move from safer practice toward practical output

### 6. `## 6. ✅ Your Turn: Complete the Mission!`

Purpose:

- culminate the homework in one purposeful communicative task
- make the student use the week's language to do something meaningful
- connect directly back to the Mission Briefing
- create one realistic reason for the student to actually open their mouth and speak English outside
  the live lesson

Protected invariants:

- the main task should clearly complete the mission set at the start
- it should require production, not just recognition
- it should feel realistic for a one-on-one adult learner
- the optional `Plus` task should deepen the same mission rather than introducing a new unrelated
  objective
- the task should give the learner a framework for expressing thoughts, opinions, retelling, or
  advice in English rather than testing raw creativity
- the task should avoid two weak extremes:
  - over-creative prompts that require inventing an elaborate story before language practice can
    begin
  - shallow question lists that invite one-sentence answers and premature completion

Preferred mission patterns:

- respond to a situation or problem from the study text
- give advice, recommendations, or opinions to a person in the source
- retell the study text in the student's own words
- explain what the student agrees or disagrees with and why
- adapt the source situation to the student's own life in a structured way

Learner-fit rule:

- for shy, beginner, low-confidence, or less imaginative learners, the mission should reduce
  creative burden and increase speaking support
- the system should prefer structured speaking frameworks over open-ended invention when that makes
  speech more likely to happen
- if simple retelling is the most realistic path to actual spoken output, that is a valid and often
  valuable mission design

### 7. `## 7. 🧠 Why This Mission Helps You`

Purpose:

- make the assignment feel personal and purposeful
- connect this week's work to the student's broader goals
- increase buy-in by showing the logic behind the task

Protected invariants:

- the rationale should be specific to the student
- it should link the mission to real goals, not generic encouragement
- it should stay concise and human

### 8. `## 8. 🔑 Answer Key & Sample Mission`

Purpose:

- support independent checking
- reduce uncertainty after practice
- model an acceptable final output without replacing the student's own effort

Protected invariants:

- the answer key should help the student self-correct
- the sample mission response should model target language from the week's source/toolkit
- the sample should support, not overshadow, the learner's own production

### 9. `## 9. 👨‍🏫 Teacher's Follow-up Plan`

Purpose:

- preserve continuity for the next live lesson
- leave the teacher with a warm-up entry point and a listening target
- create a compact bridge from this homework to future teaching decisions

Protected invariants:

- this section is for the teacher, not the student
- it should stay concise and operational
- it should surface at least one next-lesson warm-up and one correction or monitoring focus

Allowed evolution:

- structure may become more memory-aware and easier to parse downstream
- it should remain compact enough to be genuinely useful in the next lesson

## Personalization Contract

Personalization is a means to better teaching, not a cosmetic flourish.

The homework should adapt to:

- the student's goals
- recurring mistakes
- current strengths and weaknesses
- preferred themes or situations when they genuinely support engagement
- the lesson's emotional tone and practical outcome

The homework should not:

- invent a fake biography or preferences
- overload the assignment with every known student detail
- personalize surface topics while ignoring the actual language priorities

## Continuity Contract in the Memory-System Era

As the memory system evolves, this assignment method should be strengthened in a disciplined way.

Use continuity inputs for different jobs:

- foundational profile:
  - durable goals
  - stable learner traits
  - trusted teacher-confirmed context
- student-memory snapshot:
  - broad patterns
  - still-open learning threads
  - long-term progression signals
- recent lesson memory:
  - tactical recent observations
  - specific mistakes and wins from recent lessons
- recent homework memory:
  - what was just assigned
  - what was reviewed recently
  - what should not be repeated immediately
- latest transcript:
  - the immediate source of truth for the current assignment

Continuity rules:

1. The latest transcript drives the current week's homework.
2. Recent homework memory matters most for avoiding repetition.
3. Long-term memory should shape targeting, not bloat the assignment.
4. Carry-forward review should be selective and purposeful.
5. The assignment should still read like one coherent weekly task, not like a visible database dump.

## What Must Stay Stable

These qualities should be treated as protected unless a later decision doc deliberately changes
them:

1. one weekly mission
2. one coherent source reused across the assignment
3. a visible workload path
4. contextualized grammar and useful chunks
5. targeted controlled practice with bounded review
6. one pronunciation micro-focus
7. a meaningful production task that completes the mission
8. a concise personalized rationale
9. a teacher-only follow-up bridge

## What May Evolve Safely

These areas may change as evals, providers, memory systems, and product surfaces improve:

1. exact prompt wording
2. section-level phrasing and tone
3. authentic-versus-generated source balance
4. exercise formats within each section
5. formatting details and visual richness
6. memory-aware personalization depth
7. provider-specific tuning behind the same pedagogical contract
8. machine-readable structure added for downstream systems

## Scope Boundaries

This doc does not define:

1. exact YAML/output syntax
2. provider-specific prompting tactics
3. validation-rule implementation details
4. database schema for lesson/homework memory
5. frontend rendering rules

Those live elsewhere. This doc exists to stop future changes from accidentally damaging the teaching
method while improving the surrounding system.

## Related

- [`docs/templates/hw_prompt_v4-4_voice-aligned.md`](../templates/hw_prompt_v4-4_voice-aligned.md)
- [`docs/templates/hw_prompt_v4-5_voice-aligned.md`](../templates/hw_prompt_v4-5_voice-aligned.md)
- [`docs/reference/PRESET_V2_SPEC.md`](PRESET_V2_SPEC.md)
- [`docs/plans/student-memory-system-upgrade/phase-4-student-rollup-and-retrieval-packaging.md`](../plans/student-memory-system-upgrade/phase-4-student-rollup-and-retrieval-packaging.md)
- [`docs/plans/student-memory-system-upgrade/phase-5-prompt-template-and-provider-runtime.md`](../plans/student-memory-system-upgrade/phase-5-prompt-template-and-provider-runtime.md)

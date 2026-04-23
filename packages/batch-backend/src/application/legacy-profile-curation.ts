import {
  FOUNDATIONAL_PROFILE_SCHEMA_VERSION,
  normalizeFoundationalProfile,
  type FoundationalProfile,
} from './foundational-profile.js';

function createCuratedProfile(profile: Omit<FoundationalProfile, 'schemaVersion'>): FoundationalProfile {
  return normalizeFoundationalProfile({
    schemaVersion: FOUNDATIONAL_PROFILE_SCHEMA_VERSION,
    ...profile,
  });
}

const CURATED_LEGACY_PROFILES: Record<string, FoundationalProfile> = {
  'anastasia-k_PROFILE_2026-01-19.md': createCuratedProfile({
    overallLevel: 'B1+ (Strong Intermediate)',
    primaryGoals: [],
    communicationContexts: [
      'Medical representative in the pharmaceutical sector in St. Petersburg.',
    ],
    interestsAndUsefulThemes: [
      'Media criticism and film analysis',
      'Knitting',
      'AI technology and practical AI use',
      'Travel disruptions, housing, and everyday logistics',
      'Technical glitches and problem-solving language',
    ],
    stableStrengths: [
      'High reading fluency with natural intonation.',
      'Strong analytical grasp of stylistic choices such as passive voice and formality.',
      'Produces structured, high-quality audio homework when given a clear frame.',
    ],
    persistentChallenges: [
      'Omission of third-person singular -s.',
      'Using will in temporal and conditional clauses.',
      'Omission of dummy subjects.',
      'Occasional double negatives.',
      'Difficulty distinguishing /I/ and /i:/ in minimal pairs.',
    ],
    studyPreferences: [
      'Prefers structured, analytical tasks over imaginative roleplay.',
      'Responds well to critique and analysis of existing material.',
      'Needs linear, clearly defined tasks to reduce decision fatigue.',
      'Use tight prep or recording limits to prevent perfectionism; she dislikes listening to her own voice recordings.',
    ],
    durableConstraints: [],
    teacherNotes:
      'Authenticity matters more to her than social performance; avoid forcing fake positivity or overly theatrical roleplay.',
  }),
  'dasha.md': createCuratedProfile({
    overallLevel: 'A2',
    primaryGoals: [
      'Transition photography into her main professional pursuit and source of income.',
    ],
    communicationContexts: [
      'Co-founder and manager of a coffee shop in Saint Petersburg serving international customers.',
    ],
    interestsAndUsefulThemes: [
      'Photography',
      'Coffee-shop and hospitality situations',
    ],
    stableStrengths: [
      'Confident speaker with high communicative fluency.',
      'Good metalinguistic awareness of her own article omission and literal translation habits.',
      'Strong passive vocabulary and contextual comprehension.',
    ],
    persistentChallenges: [
      'Article omission before professions and singular countable nouns.',
      'Article logic with tricky words and uncountable nouns.',
      'Third-person singular -s and adverb placement under pressure.',
      'Extra prepositions in time expressions.',
    ],
    studyPreferences: [
      'Often completes homework the evening before the lesson.',
      'Perfectionist with speaking homework and may over-script or over-record.',
      'Needs clear why explanations to deconstruct fossilized habits.',
      'Responds well to direct correction of low-hanging-fruit errors and practical roleplay.',
    ],
    durableConstraints: [],
    teacherNotes:
      'High fluency currently outpaces foundational accuracy; keep balancing confidence with systematic repair.',
  }),
  'PROFILE_2025-11-16.md': createCuratedProfile({
    overallLevel: 'A2+ (Transitioning to B1)',
    primaryGoals: [
      'Travel confidently and stay connected with family abroad.',
      'Maintain future-ready English for her managerial role.',
    ],
    communicationContexts: [
      'Managerial work with a demanding schedule.',
      'Travel planning and family communication.',
    ],
    interestsAndUsefulThemes: [
      'Singing and folk performance',
      'Embroidery',
      'Yoga',
      'Baking and sponge cakes',
      'Animal care',
      'Travel logistics',
    ],
    stableStrengths: [
      'Strong conceptual logic and interest in understanding why grammar works.',
      'Responds well to rhythm- and music-based speaking work.',
      'Reliable SVO order and core verb-pattern control.',
      'Good lexical footing in office routines, baking, and travel.',
    ],
    persistentChallenges: [
      'Analysis paralysis when searching for exact wording or structures.',
      'Third-person singular -s.',
      '"I am agree / not agree" pattern.',
      'Russian word order in indirect questions and reflexive verb errors.',
      'Article inconsistency.',
      'Past Simple irregular recall under pressure.',
      'Future forms and obligation contrasts still need stabilization.',
      'Pronunciation issues around silent letters, syllable count, word stress, and key sound contrasts.',
    ],
    studyPreferences: [
      'Benefits from structured constraints in recorded tasks.',
      'Use rhythm over speed to reduce filler sounds.',
      'Use gentle immediate correction for fossilized errors without breaking flow.',
      'Timed oral summaries help force smoothness and reduce hesitation.',
    ],
    durableConstraints: [
      'Returning to English after a break of more than five years.',
      'Strong German (B1/B2) creates lexical and structural interference.',
    ],
    teacherNotes: null,
  }),
  'margarita_PROFILE_2026-01-26.md': createCuratedProfile({
    overallLevel: 'A2+ (Pre-Intermediate), bridging into B1',
    primaryGoals: [],
    communicationContexts: [
      'Interior design and freelance book illustration / design.',
    ],
    interestsAndUsefulThemes: [
      'Book illustration and adult fiction covers',
      'Harry Potter',
      "K-dramas such as Single's Inferno",
      'Family visits in rural areas',
    ],
    stableStrengths: [
      'Highly diligent and analytical learner.',
      'Near-perfect written work.',
      'Strong self-correction once prompted.',
      'Good control of core narrative tenses, modals, time connectors, and noun modifiers.',
    ],
    persistentChallenges: [
      'Over-analysis and freezing in spontaneous speech.',
      'Using indefinite articles with uncountable nouns.',
      'L1 interference with in / on / at, especially for digital media and geography.',
      'First conditional still needs stabilization.',
      'Persistent /v/ versus /w/ contrast and several vowel / stress traps.',
    ],
    studyPreferences: [
      'Values grammar theory and structured exercises.',
      'Requests high-challenge Russian-to-English translation tasks.',
      'Keyword-based voice notes help bypass the speaking block.',
      'Uses shadowing and immersion content to build speed and listening confidence.',
      'Often completes homework shortly before lessons.',
    ],
    durableConstraints: [],
    teacherNotes: null,
  }),
  'NEW PROFILE.md': createCuratedProfile({
    overallLevel: null,
    primaryGoals: [],
    communicationContexts: [
      'IT work as an expert at Northsoft, a subsidiary of Nornickel.',
    ],
    interestsAndUsefulThemes: [
      'Cross-country cycling',
      'Snowboarding',
      'Extreme winter running',
      'Technical / programming analogies',
    ],
    stableStrengths: [
      'Strong communicative competence in sustained, detailed speech.',
      'Effectively maps grammar to logical or technical frameworks.',
      'Good intuition for countable versus uncountable nouns.',
    ],
    persistentChallenges: [
      'Aspect and duration errors, especially using Present Simple for actions continuing from the past.',
      'Agent noun confusion.',
      'Plural marking on time-related units and teach / learn confusion.',
      'Article logic in professional and technical contexts.',
    ],
    studyPreferences: [
      'Responds well to logical and technical analogies, including programming-based explanations.',
    ],
    durableConstraints: [],
    teacherNotes:
      'High communicative baseline currently outpaces grammar accuracy, so keep explanations precise and practical.',
  }),
  'oleg_PROFILE_2026-01-13.md': createCuratedProfile({
    overallLevel: 'Beginner (A1 Emerging)',
    primaryGoals: [
      'Use survival English for travel.',
      'Improve memory retention for English.',
    ],
    communicationContexts: [
      'Running a small coffee bar / cafe and describing daily business operations.',
    ],
    interestsAndUsefulThemes: [
      'Cafe operations and guest interactions',
      'Travel',
      'Morning routines',
      'Nature and park vocabulary',
    ],
    stableStrengths: [
      'Consistent possessive pronouns.',
      'Strong grasp of the To Be versus Can distinction.',
      'Confident reading of long descriptive texts with core vocabulary.',
      'Growing ability to build more complex sentences with conjunctions.',
      'Good self-correction awareness and strong retention after study gaps.',
    ],
    persistentChallenges: [
      'Russian word order and literal existence structures.',
      'Inserting to be before active verbs.',
      'Dropping articles in spontaneous speech.',
      'Overusing directional prepositions such as go to home.',
      'Lexical confusion such as job as a verb.',
      'Silent letters, key vowel contrasts, and laugh / love consonant confusion.',
    ],
    studyPreferences: [
      'Processes English through binary rules and benefits from Russian translation anchors.',
      'Responds well to antonym mapping and visual cues.',
      'ReWord flashcards significantly improve retention.',
    ],
    durableConstraints: [],
    teacherNotes: null,
  }),
  'svetlana_PROFILE_2026-01-19.md': createCuratedProfile({
    overallLevel: 'Solid B2',
    primaryGoals: [
      'Transition into AI-related product management roles.',
    ],
    communicationContexts: [
      'Entrepreneurial and accounting contexts.',
      'AI-assisted CV and job-market navigation.',
      'Family health management and bureaucratic / international business forms.',
    ],
    interestsAndUsefulThemes: [
      'Tech automation',
      'AI implementation',
      'Health management',
      'Bureaucratic and international business forms',
    ],
    stableStrengths: [
      'Advanced grammar theory and comfort with abstract rules.',
      'Analytical, logical, structural learner who thrives on formulas and explicit phonetic rules.',
      'Tech-savvy and resourceful with AI tools, VPNs, and alternative communication tools.',
    ],
    persistentChallenges: [
      'Reflexive overuse such as I feel myself tired.',
      'Missing or wrong prepositions with verbs such as listen, tell, and explain.',
      'Dropping required objects after transitive verbs.',
      'Lexical traps such as opportunity for option and advices for advice.',
      'Pronunciation trouble with rough, bankrupt, clairvoyant, /ae/ versus /e/, and contraction flow.',
      'Articles and transitive verb control in storytelling.',
    ],
    studyPreferences: [
      'Always include a section for correcting four to six fossilized errors.',
      'Coach her toward clean advanced structures rather than literal Russian-style complexity.',
      'Use structured tables or columns and explain the why behind corrections.',
      'Keep audio tasks speaker-safe and include short pronunciation shadowing.',
      'Use professional and domestic themes she actually faces.',
    ],
    durableConstraints: [
      'Cannot wear headphones; all audio must work over speakers or phone speakers.',
    ],
    teacherNotes:
      'Her main friction point is the gap between very strong intellectual understanding and less stable spontaneous speech.',
  }),
  'tolik_PROFILE_2026-01-13.md': createCuratedProfile({
    overallLevel: null,
    primaryGoals: [],
    communicationContexts: [
      'IT product management and transition into data analysis.',
    ],
    interestsAndUsefulThemes: [
      'Gaming and Steam Deck use',
      'Electronic music production and analog synth hardware',
      'Pickleball tactics and serves',
      'Workspace aesthetics and smartphone photography',
      'Harry Potter',
    ],
    stableStrengths: [
      'Strong tense-system logic across core forms.',
      'Good future-form certainty logic.',
      'High awareness of object versus subject questions and indirect-question order.',
      'Good countability logic, including collective nouns and tricky uncountables.',
    ],
    persistentChallenges: [
      'Russian-influenced word order.',
      'Auxiliary omission in spontaneous questions.',
      'Using Present Perfect with specific past time markers.',
      'Third-person singular -s.',
      'Article / number agreement with plural nouns.',
      'Treating uncountables as plural.',
      'Key pronunciation targets such as /I/ versus /i:/ and specific fossilized vowels.',
      'Using on rather than in with devices.',
    ],
    studyPreferences: [
      'Thrives on formulas, matrices, and clear logic scales.',
      'Prefers lexical chunks and full sentences over isolated vocabulary.',
      'Uses one-take recordings to force spontaneity.',
      'Uses BBC and YouTube shadowing for rhythm and intonation.',
      'Prefers handwriting and structured notebook work.',
    ],
    durableConstraints: [],
    teacherNotes: null,
  }),
  'vadim_PROFILE_2026-01-19.md': createCuratedProfile({
    overallLevel: 'B1+',
    primaryGoals: [],
    communicationContexts: [
      'University studies in IT and software engineering.',
      'Technical discussions and YouTube content creation.',
    ],
    interestsAndUsefulThemes: [
      'Souls-like and narrative-heavy games',
      'Sci-fi and tech-adjacent media',
      'Developer tooling and quality-of-life tech ecosystems',
      'YouTube content creation',
    ],
    stableStrengths: [
      'Strong technical lexis.',
      'Quick grasp of the why behind grammar.',
      'High capacity for self-correction when prompted.',
    ],
    persistentChallenges: [
      'Article omission before singular countable nouns.',
      'Plural and agreement omissions, including third-person singular -s.',
      'Extra syllable in regular past tense -ed endings.',
      'Stress bias on Russian-cognate words.',
      'Mispronunciation of tired.',
      'Using in instead of on for public transport.',
    ],
    studyPreferences: [
      'Responds best to logical, rule-based explanations and technical analogies.',
      'Use gaming and tech contexts to practice tense control and narrative flow.',
      'Focused phonetic drills and sound checks pay off.',
    ],
    durableConstraints: [],
    teacherNotes:
      'He is very aware of workload and diminishing returns, so concise high-ROI tasks work better than bloated homework.',
  }),
  'veronika_PROFILE_2026-01-19.md': createCuratedProfile({
    overallLevel: 'A2+ (Strong Pre-Intermediate)',
    primaryGoals: [],
    communicationContexts: [
      'School-age learner who performs better with concrete descriptive or third-person tasks than with personal open-ended discussion.',
    ],
    interestsAndUsefulThemes: [
      'Art and drawing',
      'Animal Crossing and game-like tasks',
      'Third-person narratives',
      'Food and health topics',
    ],
    stableStrengths: [
      'Methodical and diligent.',
      'Responds well to structure and analytical explanations.',
      'Stronger at descriptive tasks than abstract personal explanation.',
      'Good understanding of present continuous as temporary state and the theory behind verb patterns.',
    ],
    persistentChallenges: [
      'Pronunciation of -ed endings.',
      'Verb patterns (to versus ing) still need automation.',
      'Technology prepositions such as on the internet and on the phone.',
      'Double negatives.',
      'Articles and prepositions such as for breakfast.',
    ],
    studyPreferences: [
      'Avoid personal why questions; use how / what questions or third-person prompts.',
      'Gamify drills through Animal Crossing or mystery-game contexts.',
      'Group pronunciation practice by /t/, /d/, and /Id/ for -ed endings.',
    ],
    durableConstraints: [],
    teacherNotes:
      'She has a peanut allergy and often treats food as fuel rather than enjoyment, which can be a useful framing detail for topic choices.',
  }),
  'yulia-g_PROFILE_2026-01-19.md': createCuratedProfile({
    overallLevel: 'B1+ (Strong Intermediate)',
    primaryGoals: [],
    communicationContexts: [
      'Remote work in Novosibirsk managing colleagues across multiple time zones.',
      'Frequent business travel and logistics-heavy communication.',
    ],
    interestsAndUsefulThemes: [
      'Psychology and professional deformation',
      'Business logic and structural systems',
      'Travel logistics',
      'Her puppy Kefir',
    ],
    stableStrengths: [
      'High communicative resilience and narrative endurance.',
      'Can discuss complex abstract topics with good fluency.',
      'Responds well to analytical, rule-based explanations and contextualized logic.',
    ],
    persistentChallenges: [
      'Prepositions such as concentrate on, late for, and afraid of.',
      'Such a versus so with noun phrases.',
      'Verb plus verb patterns.',
      'Present Continuous versus Will nuance in dialogue.',
      'Who versus which for people.',
      'Existential logic in narratives.',
      'Pronunciation targets around syncope, silent letters, and key vowel sounds.',
    ],
    studyPreferences: [
      'Provide strict immediate correction on prepositions and high-frequency pronunciation targets.',
      'During long storytelling, prioritize flow and debrief accuracy afterward.',
      'Prefers generated materials that mirror her real life.',
      'Prefers concise homework (15-25 minutes) with voice-note missions and short shadowing.',
      'Appreciates verified collocations and natural word pairings.',
    ],
    durableConstraints: [
      'Uses AI tools for language research but access can be unstable.',
    ],
    teacherNotes: null,
  }),
};

export function getCuratedLegacyFoundationalProfile(profileId: string): FoundationalProfile | null {
  return CURATED_LEGACY_PROFILES[profileId] ?? null;
}

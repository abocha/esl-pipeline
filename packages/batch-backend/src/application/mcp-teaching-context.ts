import { z } from 'zod';

import {
  MCP_TEACHING_CONTEXT_VERSION,
  type McpTeachingContextDto,
  type McpTeachingNoteDto,
} from '@esl-pipeline/contracts';

import type { TeachingContext } from './student-teaching-context.js';

const noteSchema = z.object({ label: z.string(), note: z.string() }).strict();

export const mcpTeachingContextSchema = z
  .object({
    contractVersion: z.literal(MCP_TEACHING_CONTEXT_VERSION),
    student: z.object({ studentId: z.string(), name: z.string() }).strict(),
    profile: z
      .object({
        level: z.string().nullable(),
        goals: z.array(z.string()),
        communicationContexts: z.array(z.string()),
        usefulThemes: z.array(z.string()),
        strengths: z.array(z.string()),
        challenges: z.array(z.string()),
        studyPreferences: z.array(z.string()),
      })
      .strict()
      .nullable(),
    memory: z
      .object({
        strengths: z.array(noteSchema),
        recurringIssues: z.array(noteSchema),
        reviewBacklog: z.array(noteSchema),
        recentProgress: z.array(noteSchema),
        unresolvedIssues: z.array(noteSchema),
      })
      .strict()
      .nullable(),
    recentLessons: z.array(
      z
        .object({
          generatedAt: z.string(),
          title: z.string().nullable(),
          summary: z.string().nullable(),
          topics: z.array(noteSchema),
          mistakes: z.array(noteSchema),
          grammar: z.array(noteSchema),
          vocabulary: z.array(noteSchema),
          pronunciation: z.array(noteSchema),
          followUp: z.array(noteSchema),
        })
        .strict(),
    ),
    recentHomework: z.array(
      z
        .object({
          publishedAt: z.string(),
          summary: z.string().nullable(),
          topic: z.string().nullable(),
          grammar: z.array(noteSchema),
          vocabulary: z.array(noteSchema),
          review: z.array(noteSchema),
          outcome: z.string().nullable(),
          followUp: z.array(noteSchema),
        })
        .strict(),
    ),
  })
  .strict();

function note(label: string, value: string): McpTeachingNoteDto {
  return { label, note: value };
}

/** Explicit allowlist; internal provenance and personal-fact fields never enter the wire DTO. */
export function projectMcpTeachingContext(source: TeachingContext): McpTeachingContextDto {
  const profile = source.profile;
  const memory = source.memorySnapshot;
  return {
    contractVersion: MCP_TEACHING_CONTEXT_VERSION,
    student: { studentId: source.student.id, name: source.student.name },
    profile: profile
      ? {
          level: profile.overallLevel,
          goals: profile.primaryGoals,
          communicationContexts: profile.communicationContexts,
          usefulThemes: profile.interestsAndUsefulThemes,
          strengths: profile.stableStrengths,
          challenges: profile.persistentChallenges,
          studyPreferences: profile.studyPreferences,
        }
      : null,
    memory: memory
      ? {
          strengths: memory.stableStrengths.map((item) => note(item.label, item.note)),
          recurringIssues: memory.recurringIssues.map((item) => note(item.label, item.note)),
          reviewBacklog: memory.activeReviewBacklog.map((item) => note(item.label, item.note)),
          recentProgress: memory.recentProgress.map((item) => note(item.label, item.note)),
          unresolvedIssues: memory.unresolvedIssues.map((item) => note(item.label, item.note)),
        }
      : null,
    recentLessons: source.recentLessons.map((lesson) => ({
      generatedAt: lesson.generatedAt,
      title: lesson.title,
      summary: lesson.summary,
      topics: lesson.topicsDiscussed.map((item) => note(item.topic, item.note)),
      mistakes: lesson.mistakePatterns.map((item) => note(item.label, item.explanation)),
      grammar: lesson.grammarWatchlist.map((item) => note(item.name, item.note)),
      vocabulary: lesson.vocabularyFocus.map((item) => note(item.text, item.note)),
      pronunciation: lesson.pronunciationFocus.map((item) => note(item.label, item.note)),
      followUp: lesson.followUpRecommendations.map((item) => note(item.label, item.note)),
    })),
    recentHomework: source.recentHomework.map((homework) => ({
      publishedAt: homework.publishedAt,
      summary: homework.summary,
      topic: homework.topic,
      grammar: homework.grammarTargets.map((item) => note(item.name, item.note)),
      vocabulary: homework.vocabularyTargets.map((item) => note(item.text, item.note)),
      review: homework.reviewTargets.map((item) => note(item.label, item.note)),
      outcome: homework.communicativeOutcome,
      followUp: homework.teacherFollowUpCues.map((item) => note(item.cueType, item.note)),
    })),
  };
}

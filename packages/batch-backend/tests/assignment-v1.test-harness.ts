import { readFileSync as readAssignmentFixture } from 'node:fs';

import type { AssignmentV1 as FixtureAssignmentV1 } from '@esl-pipeline/contracts';
import { ASSIGNMENT_TEMPLATE_CONTRACT, ASSIGNMENT_TEMPLATE_ID } from '@esl-pipeline/contracts';

import { stitchPromptEnvelope } from '../src/application/prompt-assembly.js';

export function promptPackageFixture() {
  const requestEnvelope = stitchPromptEnvelope({
    template: `${ASSIGNMENT_TEMPLATE_CONTRACT}\nCreate a useful homework assignment.`,
    canonicalStudentName: 'Eval Persona One',
    profile: 'B1',
    studentMemorySnapshot: '',
    recentLessonMemory: '',
    recentHomeworkMemory: '',
    unresolvedIssues: '',
    transcript: 'First, then, finally.',
    notes: 'Input Type: generate',
  });
  return {
    id: 'prompt-1',
    text: 'PROMPT',
    requestEnvelope,
    templateSnapshot: { resolvedTemplateId: ASSIGNMENT_TEMPLATE_ID },
  };
}

export function openAiAssignmentPayload(text: string = JSON.stringify(assignmentFixture())) {
  return {
    id: 'resp-assignment',
    model: 'gpt-6.1-sol',
    status: 'completed',
    usage: { input_tokens: 12, output_tokens: 24, total_tokens: 36 },
    output: [
      {
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text }],
      },
    ],
  };
}

export function assignmentFixture(): FixtureAssignmentV1 {
  return JSON.parse(
    readAssignmentFixture(
      new URL('../../contracts/tests/assignment-fixture.json', import.meta.url),
      'utf8',
    ),
  ) as FixtureAssignmentV1;
}

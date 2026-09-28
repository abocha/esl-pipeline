import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer, type Tool } from '@modelcontextprotocol/server';
import type { FastifyInstance } from 'fastify';
import type Provider from 'oidc-provider';
import { z } from 'zod';

import type {
  FindStudentResultDto,
  GetStudentTeachingContextResultDto,
} from '@esl-pipeline/contracts';

import { findStudent } from '../application/find-student.js';
import {
  mcpTeachingContextSchema,
  projectMcpTeachingContext,
} from '../application/mcp-teaching-context.js';
import { getStudentTeachingContext } from '../application/student-teaching-context.js';
import { type BoundOAuthGrant, MCP_READ_SCOPE } from '../domain/mcp-oauth-grants.js';
import { type McpOAuthConfig, verifyMcpOAuthCredential } from './mcp-oauth.js';

const authSchemes = [{ type: 'oauth2', scopes: [MCP_READ_SCOPE] }] as const;
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const findDescription =
  'Find up to five matching learner names in your connected ESL Pipeline workspace. Use a tutor-supplied name.';
const contextDescription =
  'Read the current teaching context for one learner in your connected ESL Pipeline workspace.';
const findInputSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
const contextInputSchema = z.object({ studentId: z.string().uuid() }).strict();
const findResultSchema = z
  .object({
    status: z.enum(['none', 'single', 'ambiguous']),
    candidates: z.array(z.object({ studentId: z.string(), name: z.string() }).strict()).max(5),
    hasMore: z.boolean(),
  })
  .strict();
const contextResultSchema = z.object({ context: mcpTeachingContextSchema }).strict();

function challenge(config: McpOAuthConfig) {
  const metadata = new URL('/api/.well-known/oauth-protected-resource', config.resource).href;
  return `Bearer resource_metadata="${metadata}", scope="${MCP_READ_SCOPE}", error="invalid_token", error_description="Connect an ESL Pipeline account with teaching context read access"`;
}

function authError(config: McpOAuthConfig) {
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: 'Authentication required.' }],
    _meta: { 'mcp/www_authenticate': [challenge(config)] },
  };
}

function unavailable() {
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: 'Teaching context unavailable.' }],
  };
}

function createServer(config: McpOAuthConfig, grant: BoundOAuthGrant | null): McpServer {
  const server = new McpServer({ name: 'esl-pipeline', version: '1.0.0' });
  server.registerTool(
    'find_student',
    {
      title: 'Find student',
      description: findDescription,
      inputSchema: findInputSchema,
      outputSchema: findResultSchema,
      annotations,
      _meta: { securitySchemes: authSchemes },
    },
    async ({ name }) => {
      if (!grant) return authError(config);
      try {
        const result: FindStudentResultDto = await findStudent({
          workspaceId: grant.workspaceId,
          name,
        });
        return {
          content: [
            {
              type: 'text',
              text:
                result.status === 'none'
                  ? 'No matching student found.'
                  : `${result.candidates.length} matching student${result.candidates.length === 1 ? '' : 's'} found${result.hasMore ? '; more matches exist' : ''}.`,
            },
          ],
          structuredContent: result,
        };
      } catch {
        return unavailable();
      }
    },
  );
  server.registerTool(
    'get_student_teaching_context',
    {
      title: 'Get student teaching context',
      description: contextDescription,
      inputSchema: contextInputSchema,
      outputSchema: contextResultSchema,
      annotations,
      _meta: { securitySchemes: authSchemes },
    },
    async ({ studentId }) => {
      if (!grant) return authError(config);
      try {
        const source = await getStudentTeachingContext({
          workspaceId: grant.workspaceId,
          studentId,
        });
        if (!source)
          return { isError: true, content: [{ type: 'text', text: 'Student not found.' }] };
        const result: GetStudentTeachingContextResultDto = {
          context: projectMcpTeachingContext(source),
        };
        return {
          content: [
            {
              type: 'text',
              text: `Current teaching context for ${result.context.student.name}: level ${result.context.profile?.level ?? 'not recorded'}, ${result.context.recentLessons.length} recent lessons and ${result.context.recentHomework.length} recent homework entries.`,
            },
          ],
          structuredContent: result,
        };
      } catch {
        return unavailable();
      }
    },
  );
  // SDK 2.1 exposes extension metadata but does not yet accept OpenAI's
  // top-level securitySchemes field. Publish both forms for ChatGPT clients.
  const tools = [
    {
      name: 'find_student',
      title: 'Find student',
      description: findDescription,
      inputSchema: z.toJSONSchema(findInputSchema),
      outputSchema: z.toJSONSchema(findResultSchema),
      annotations,
      securitySchemes: authSchemes,
      _meta: { securitySchemes: authSchemes },
    },
    {
      name: 'get_student_teaching_context',
      title: 'Get student teaching context',
      description: contextDescription,
      inputSchema: z.toJSONSchema(contextInputSchema),
      outputSchema: z.toJSONSchema(contextResultSchema),
      annotations,
      securitySchemes: authSchemes,
      _meta: { securitySchemes: authSchemes },
    },
  ] as unknown as Tool[];
  server.server.setRequestHandler('tools/list', () => ({ tools }));
  return server;
}

export function registerMcpServer(
  app: FastifyInstance,
  provider: Provider,
  config: McpOAuthConfig,
): void {
  const handler = createMcpHandler(async ({ requestInfo }) => {
    const bearer = requestInfo?.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
    const grant = bearer ? await verifyMcpOAuthCredential(provider, bearer, config) : null;
    return createServer(config, grant);
  });
  const nodeHandler = toNodeHandler(handler);
  app.get('/mcp', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const bearer = request.headers.authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!bearer || !(await verifyMcpOAuthCredential(provider, bearer, config))) {
      return reply
        .code(401)
        .header('www-authenticate', challenge(config))
        .send({ error: 'unauthorized' });
    }
    return reply.code(405).header('allow', 'POST').send({ error: 'method_not_allowed' });
  });
  app.post('/mcp', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const authorization = request.headers.authorization;
    if (
      (authorization && !/^Bearer ([^\s]+)$/i.test(authorization)) ||
      (authorization && !(await verifyMcpOAuthCredential(provider, authorization.slice(7), config)))
    ) {
      return reply
        .code(401)
        .header('www-authenticate', challenge(config))
        .send({ error: 'unauthorized' });
    }
    reply.hijack();
    reply.raw.setHeader('cache-control', 'no-store');
    await nodeHandler(request.raw, reply.raw, request.body);
  });
}

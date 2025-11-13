// packages/batch-backend/src/transport/security-headers.ts
//
// Security headers middleware for Fastify.
// Implements Helmet.js-like functionality with configurable security headers.

import { FastifyRequest, FastifyReply } from 'fastify';
import { loadConfig } from '../config/env';
import { logger } from '../infrastructure/logger';

export interface SecurityHeadersConfig {
  enabled: boolean;
  helmet: {
    contentSecurityPolicy?: string | false;
    crossOriginEmbedderPolicy?: string | false;
    crossOriginOpenerPolicy?: string | false;
    crossOriginResourcePolicy?: string | false;
    dnsPrefetchControl?: string | false;
    expectCt?: string | false;
    frameguard?: string | false;
    hidePoweredBy?: boolean;
    hsts?: string | false;
    ieNoOpen?: boolean;
    noSniff?: boolean;
    originAgentCluster?: boolean;
    permittedCrossDomainPolicies?: string | false;
    referrerPolicy?: string | false;
    xssFilter?: boolean;
  };
  cors: {
    enabled: boolean;
    origin?: string;
    credentials: boolean;
    methods?: string[];
    allowedHeaders?: string[];
  };
}

/**
 * Get default security headers configuration
 */
function getDefaultSecurityConfig(): SecurityHeadersConfig {
  const config = loadConfig();

  return {
    enabled: config.security.securityHeadersEnabled,
    helmet: {
      contentSecurityPolicy: "default-src 'self'",
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      dnsPrefetchControl: 'off',
      expectCt: false,
      frameguard: 'DENY',
      hidePoweredBy: true,
      hsts: config.security.hstsMaxAge > 0 ? `max-age=${config.security.hstsMaxAge}; includeSubDomains` : false,
      ieNoOpen: true,
      noSniff: true,
      originAgentCluster: false,
      permittedCrossDomainPolicies: 'none',
      referrerPolicy: 'strict-origin-when-cross-origin',
      xssFilter: true,
    },
    cors: {
      enabled: config.security.enableCors,
      origin: config.security.corsOrigin,
      credentials: config.security.corsCredentials,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    },
  };
}

/**
 * Apply Helmet.js security headers
 */
function applyHelmetHeaders(reply: FastifyReply, config: SecurityHeadersConfig['helmet']): void {
  if (config.contentSecurityPolicy !== false) {
    reply.header('Content-Security-Policy', config.contentSecurityPolicy);
  }

  if (config.crossOriginEmbedderPolicy !== false) {
    reply.header('Cross-Origin-Embedder-Policy', config.crossOriginEmbedderPolicy);
  }

  if (config.crossOriginOpenerPolicy !== false) {
    reply.header('Cross-Origin-Opener-Policy', config.crossOriginOpenerPolicy);
  }

  if (config.crossOriginResourcePolicy !== false) {
    reply.header('Cross-Origin-Resource-Policy', config.crossOriginResourcePolicy);
  }

  if (config.dnsPrefetchControl !== false) {
    reply.header('X-DNS-Prefetch-Control', config.dnsPrefetchControl);
  }

  if (config.expectCt !== false) {
    reply.header('Expect-CT', config.expectCt);
  }

  if (config.frameguard !== false) {
    reply.header('X-Frame-Options', config.frameguard);
  }

  if (config.hidePoweredBy) {
    reply.header('X-Powered-By', ''); // Remove header by setting empty value
  }

  if (config.hsts !== false) {
    reply.header('Strict-Transport-Security', config.hsts);
  }

  if (config.ieNoOpen) {
    reply.header('X-Download-Options', 'noopen');
  }

  if (config.noSniff) {
    reply.header('X-Content-Type-Options', 'nosniff');
  }

  if (config.originAgentCluster) {
    reply.header('Origin-Agent-Cluster', '?1');
  }

  if (config.permittedCrossDomainPolicies !== false) {
    reply.header('X-Permitted-Cross-Domain-Policies', config.permittedCrossDomainPolicies);
  }

  if (config.referrerPolicy !== false) {
    reply.header('Referrer-Policy', config.referrerPolicy);
  }

  if (config.xssFilter) {
    reply.header('X-XSS-Protection', '1; mode=block');
  }
}

/**
 * Apply CORS headers
 */
function applyCorsHeaders(reply: FastifyReply, config: SecurityHeadersConfig['cors']): void {
  if (!config.enabled) {
    return;
  }

  if (config.origin) {
    reply.header('Access-Control-Allow-Origin', config.origin);
  }

  if (config.credentials) {
    reply.header('Access-Control-Allow-Credentials', 'true');
  }

  if (config.methods) {
    reply.header('Access-Control-Allow-Methods', config.methods.join(', '));
  }

  if (config.allowedHeaders) {
    reply.header('Access-Control-Allow-Headers', config.allowedHeaders.join(', '));
  }

  // Add Vary header for CORS
  reply.header('Vary', 'Origin');
}

/**
 * Security headers middleware
 */
export function securityHeadersMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void
): void {
  try {
    const config = getDefaultSecurityConfig();

    if (!config.enabled) {
      return done();
    }

    // Apply Helmet headers
    applyHelmetHeaders(reply, config.helmet);

    // Apply CORS headers
    applyCorsHeaders(reply, config.cors);

    // Add additional security headers
    reply.header('X-Request-ID', (request as any).id || 'unknown');

    logger.debug('Security headers applied', {
      requestId: (request as any).id,
      method: request.method,
      url: request.url,
      corsEnabled: config.cors.enabled,
      hstsEnabled: !!config.helmet.hsts,
    });

    done();
  } catch (error) {
    logger.error('Security headers middleware error', {
      error: error instanceof Error ? error.message : String(error),
      requestId: (request as any).id,
      method: request.method,
      url: request.url,
    });

    // Continue processing even if headers fail
    done();
  }
}

/**
 * Pre-flight OPTIONS handler for CORS
 */
export async function handleCorsPreflight(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const config = getDefaultSecurityConfig();

  if (!config.cors.enabled) {
    return reply.code(404).send({ error: 'Not found' });
  }

  // Apply CORS headers for preflight
  applyCorsHeaders(reply, config.cors);

  return reply.code(200).send();
}

/**
 * Hook to register security headers with Fastify
 */
export function registerSecurityHeaders(app: import('fastify').FastifyInstance): void {
  const config = getDefaultSecurityConfig();

  if (!config.enabled) {
    logger.info('Security headers disabled');
    return;
  }

  // Register middleware for all routes
  app.addHook('onRequest', securityHeadersMiddleware);

  // Handle CORS preflight requests
  if (config.cors.enabled) {
    app.options('*', handleCorsPreflight);
  }

  logger.info('Security headers registered', {
    corsEnabled: config.cors.enabled,
    hstsEnabled: !!config.helmet.hsts,
    cspEnabled: config.helmet.contentSecurityPolicy !== false,
  });
}
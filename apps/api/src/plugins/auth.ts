/**
 * Verifies Supabase Auth access tokens and attaches the caller's user id to the request.
 *
 * Supabase issues HS256-signed JWTs. Verifying the signature locally against the project's
 * JWT secret means authenticating a request costs a signature check, not a network round
 * trip to Supabase — important because every request the app makes to this service (chat,
 * plan generation) goes through this check.
 *
 * This does NOT replace Postgres RLS. The app talks to Supabase directly for CRUD, and RLS
 * is what protects that path. This plugin protects the separate surface this API service
 * owns: AI calls and calculations, where `request.userId` scopes which user's data the
 * route is allowed to read before it ever reaches the database.
 */

import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { errors as joseErrors, jwtVerify } from 'jose';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    /** Set by `authenticate` once the bearer token's signature and claims are verified. */
    userId?: string;
  }
}

export interface AuthPluginOptions {
  jwtSecret: string;
}

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (app, opts) => {
  const secretKey = new TextEncoder().encode(opts.jwtSecret);

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      await reply.code(401).send({ error: 'unauthorized', message: 'Missing bearer token' });
      return;
    }

    try {
      const { payload } = await jwtVerify(token, secretKey);

      // Supabase sets `sub` to the auth.users.id — the same id every RLS policy in the
      // schema keys on. `role` should read 'authenticated'; 'anon' means the client sent
      // its anon key instead of a user's access token, which must not pass as identity.
      if (typeof payload.sub !== 'string' || payload.role !== 'authenticated') {
        await reply.code(401).send({ error: 'unauthorized', message: 'Invalid token claims' });
        return;
      }

      request.userId = payload.sub;
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) {
        await reply.code(401).send({ error: 'unauthorized', message: 'Token expired' });
        return;
      }
      await reply.code(401).send({ error: 'unauthorized', message: 'Invalid token' });
    }
  });
};

export default fp(authPlugin, { name: 'auth' });

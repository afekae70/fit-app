import type { FastifyPluginAsync } from 'fastify';

const healthRoutes: FastifyPluginAsync = async (app) => {
  // Deliberately unauthenticated and dependency-free: this is what a load balancer or
  // uptime check hits, and it must answer even if the database or an upstream AI provider
  // is down — otherwise a Supabase blip takes the whole service out of rotation.
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // Confirms the caller's bearer token is valid and returns which user it belongs to —
  // useful for verifying the mobile app's auth wiring against this service independent of
  // any other route.
  app.get('/health/me', { preHandler: app.authenticate }, async (request) => ({
    userId: request.userId,
  }));
};

export default healthRoutes;

import type { FastifyPluginAsync } from 'fastify';

const healthRoutes: FastifyPluginAsync = async (app) => {
  // Deliberately unauthenticated and dependency-free: this is what a load balancer or
  // uptime check hits, and it must answer even if the database or an upstream AI provider
  // is down — otherwise a Supabase blip takes the whole service out of rotation.
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    // Neither is a secret — both are defaults committed to the repository — and having them
    // here turns "which model is it actually using" from a question into a request.
    provider: app.coachProvider.name,
    model: app.coachProvider.model,
    // Which commit is actually answering. Injected by Railway; absent elsewhere, which is fine
    // — the field is for telling "the fix is live" from "the fix has not deployed yet", and
    // that question has now cost three rounds of guessing from timestamps.
    commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  }));

  // Confirms the caller's bearer token is valid and returns which user it belongs to —
  // useful for verifying the mobile app's auth wiring against this service independent of
  // any other route.
  app.get('/health/me', { preHandler: app.authenticate }, async (request) => ({
    userId: request.userId,
  }));
};

export default healthRoutes;

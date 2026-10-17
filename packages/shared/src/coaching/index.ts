/**
 * Coaching, as both sides of it see it: the calls a coach or a trainee makes to the server
 * (`api.ts`), and the documents those calls answer with — plans and calendars
 * (`planDocument.ts`) and finished workouts (`sessionDocument.ts`).
 *
 * Shared so that the app's coach screens and the coach's web dashboard read one server in one
 * way. Nothing here touches a database or a screen; the server is reached through the small
 * `RpcClient` shape, which the Supabase client satisfies.
 */
export * from './api.js';
export * from './dates.js';
export * from './planDocument.js';
export * from './sessionDocument.js';
export * from './sharedDocument.js';

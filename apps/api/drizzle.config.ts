import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Supabase connection string. Use the *pooler* URL for the app and the direct
    // connection for migrations — drizzle-kit needs the direct one.
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});

/**
 * The dashboard's Content Security Policy: what the browser may load and talk to, and nothing
 * else.
 *
 * The page holds a coach's session and shows trainees' training, weight, food and photos. If
 * anything ever managed to put a script on it — a poisoned dependency, a bug that renders text as
 * markup — the policy is what stops that script from running at all, or from sending what it
 * read anywhere but to the project's own Supabase.
 *
 *  - **Scripts:** the site's own files only. No inline script, no `eval`, no other host.
 *  - **Connections:** the site and the Supabase project. Nothing else can be fetched or posted to.
 *  - **Images:** the site, the project's storage (the signed photo links) and `data:` (the
 *    demonstration draws its photos as SVG).
 *  - **Styles:** the site's stylesheet, and inline styles — the palette is written into a
 *    `<style>` element at start (theme/theme.ts), and React sets `style` attributes. CSS cannot
 *    run code, which is why this is the one place `unsafe-inline` is allowed.
 *  - **Everything else** — frames, plugins, workers, forms to other sites, `<base>` — none.
 *
 * GitHub Pages serves no custom headers, so this goes in as a `<meta>` tag at build time
 * (vite.config.ts). A meta policy cannot say `frame-ancestors`; main.tsx refuses to show the page
 * inside a frame instead.
 */

export function contentSecurityPolicy(supabaseUrl: string): string {
  const project = new URL(supabaseUrl).origin;
  if (!project.startsWith('https://')) throw new Error(`Supabase must be https: ${project}`);
  const rules: [string, ...string[]][] = [
    ['default-src', "'none'"],
    ['script-src', "'self'"],
    ['style-src', "'self'", "'unsafe-inline'"],
    ['img-src', "'self'", 'data:', project],
    ['font-src', "'self'"],
    ['connect-src', "'self'", project],
    ['manifest-src', "'self'"],
    ['base-uri', "'none'"],
    ['form-action', "'self'"],
    ['object-src', "'none'"],
    ['frame-src', "'none'"],
    ['upgrade-insecure-requests'],
  ];
  return rules.map((rule) => rule.join(' ')).join('; ');
}

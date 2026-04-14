import { createServerClient } from '@supabase/ssr';

export function getSupabaseServerClient(req, res) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          const cookies = [];
          if (req.cookies) {
            Object.entries(req.cookies).forEach(([name, value]) => {
              cookies.push({ name, value });
            });
          }
          return cookies;
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.setHeader('Set-Cookie', [
              ...(Array.isArray(res.getHeader('Set-Cookie'))
                ? res.getHeader('Set-Cookie')
                : res.getHeader('Set-Cookie')
                  ? [res.getHeader('Set-Cookie')]
                  : []),
              `${name}=${value}; Path=${options?.path || '/'}; HttpOnly; SameSite=Lax${options?.maxAge ? `; Max-Age=${options.maxAge}` : ''}`,
            ]);
          });
        },
      },
    }
  );
}

import { Html, Head, Main, NextScript } from "next/document";

// Inline script that runs BEFORE React hydrates. Reads the saved theme
// from localStorage (or falls back to OS preference) and applies the
// `dark` class to <html> immediately, so users with dark mode never
// see a white flash of unstyled content (FOUC).
const themeInitScript = `
  (function() {
    try {
      var stored = localStorage.getItem('dd.theme');
      var theme = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
      var effective = theme;
      if (theme === 'system') {
        effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      if (effective === 'dark') {
        document.documentElement.classList.add('dark');
      }
    } catch (e) {
      // localStorage might be blocked in private browsing — fall back to light
    }
  })();
`;

export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body className="antialiased">
        {/* Anti-FOUC: applies dark class before React hydrates */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

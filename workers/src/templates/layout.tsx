import { raw } from 'hono/html'
import type { FC } from 'hono/jsx'

/**
 * Page shell. `authenticated` pages link the site title to `/albums` and show a
 * logout form button (POST `/api/auth/logout`); the public login page omits both
 * and links the title to `/`. `chrome: 'immersive'` renders no header (used by the
 * full-viewport photo preview page) and marks `<main>` with the `immersive` class;
 * the default chrome renders it as above. `head` renders extra markup inside
 * `<head>` (e.g. a `<link rel="prefetch">`). JavaScript is progressive
 * enhancement only (see docs/decisions/2026-07-03-ui-redesign.md section 2.2):
 * `/app.js` loads with `defer` on every page, and every page remains fully
 * functional with it disabled.
 */
export const Layout: FC<{
  title: string
  authenticated?: boolean
  chrome?: 'default' | 'immersive'
  head?: unknown
  children?: unknown
}> = ({ title, authenticated, chrome = 'default', head, children }) => {
  return (
    <>
      {raw('<!DOCTYPE html>')}
      <html lang="ja">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta name="theme-color" content="#131316" />
          <title>{title} - photo-gate</title>
          <link rel="stylesheet" href="/styles-v3.css" />
          <script src="/app.js" defer></script>
          {head}
        </head>
        <body>
          {chrome === 'default' ? (
            <header>
              <a class="site-title" href={authenticated ? '/albums' : '/'}>
                photo-gate
              </a>
              {authenticated ? (
                <form class="logout-form" method="post" action="/api/auth/logout">
                  <button type="submit" class="logout-button">
                    ログアウト
                  </button>
                </form>
              ) : null}
            </header>
          ) : null}
          <main class={chrome === 'immersive' ? 'immersive' : undefined}>{children}</main>
        </body>
      </html>
    </>
  )
}

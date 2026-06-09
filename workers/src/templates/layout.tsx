import { raw } from 'hono/html'
import type { FC } from 'hono/jsx'

export const Layout: FC<{ title: string; children?: unknown }> = ({ title, children }) => {
  return (
    <>
      {raw('<!DOCTYPE html>')}
      <html lang="ja">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>{title} - photo-gate</title>
          <link rel="stylesheet" href="/styles.css" />
        </head>
        <body>
          <header>
            <a class="site-title" href="/albums">
              photo-gate
            </a>
            <span class="notice">fixture data only - not for production use</span>
          </header>
          <main>{children}</main>
        </body>
      </html>
    </>
  )
}

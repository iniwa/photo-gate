import { Hono } from 'hono'
import { Layout } from '../templates/layout.js'
import { FIXTURE_ALBUMS, FIXTURE_ALBUM_DETAILS } from '../fixtures.js'

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/

function isValidId(id: string): boolean {
  return SAFE_ID.test(id)
}

export const pages = new Hono()

pages.get('/', (c) => {
  c.header('Cache-Control', 'private, no-cache')
  return c.html(
    <Layout title="Welcome">
      <div class="welcome-box">
        <h1>photo-gate</h1>
        <p class="subtitle">Private photo sharing</p>
        <div class="placeholder-note">
          <strong>Phase 2 fixture UI.</strong> Viewer login is not implemented yet.
          No real album or photo data is loaded in this phase.
        </div>
      </div>
    </Layout>,
  )
})

pages.get('/albums', (c) => {
  c.header('Cache-Control', 'private, no-cache')
  return c.html(
    <Layout title="Albums">
      <h1>Albums</h1>
      <h2>Fixture albums - no real data</h2>
      <div class="card-grid">
        {FIXTURE_ALBUMS.map((album) => (
          <div class="card" key={album.id}>
            <a href={`/albums/${album.id}`}>
              <div class="thumb-placeholder" aria-hidden="true">
                Album
              </div>
              <div class="card-body">
                <div class="card-title">{album.title}</div>
                <div class="card-meta">{album.photoCount} photos</div>
              </div>
            </a>
          </div>
        ))}
      </div>
    </Layout>,
  )
})

pages.get('/albums/:albumId', (c) => {
  c.header('Cache-Control', 'private, no-cache')
  const albumId = c.req.param('albumId')

  if (!isValidId(albumId)) {
    c.header('Cache-Control', 'no-store')
    return c.html(<NotFound />, 404)
  }

  const album = FIXTURE_ALBUM_DETAILS[albumId]
  if (album === undefined) {
    c.header('Cache-Control', 'no-store')
    return c.html(<NotFound />, 404)
  }

  return c.html(
    <Layout title={album.title}>
      <a class="back-link" href="/albums">Back to albums</a>
      <h1>{album.title}</h1>
      <h2>Fixture photos - no real images loaded</h2>
      <div class="card-grid">
        {album.photos.map((photo) => (
          <div class="card" key={photo.id}>
            <div class="thumb-placeholder" aria-hidden="true">
              Photo
            </div>
            <div class="card-body">
              <div class="card-title">{photo.title}</div>
              <div class="card-meta">{photo.id}</div>
            </div>
          </div>
        ))}
      </div>
    </Layout>,
  )
})

export function NotFound() {
  return (
    <Layout title="Not Found">
      <div class="not-found">
        <div class="code">404</div>
        <h1>Page not found</h1>
        <p>The page you requested does not exist.</p>
        <a href="/albums">Back to albums</a>
      </div>
    </Layout>
  )
}

/**
 * NON-PRODUCTION FIXTURE DATA - Phase 2 only.
 * Contains no real names, credentials, domains, PhotoPrism hashes, GPS, or personal data.
 * All IDs match ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$
 * Replace with real D1/R2 access in Phase 3.
 */

import type { AlbumSummary, AlbumDetail } from './types/album.js'

export const FIXTURE_ALBUMS: AlbumSummary[] = [
  { id: 'sample-album-001', title: 'Sample Album 001 (Fixture)', photoCount: 3 },
  { id: 'sample-album-002', title: 'Sample Album 002 (Fixture)', photoCount: 2 },
]

export const FIXTURE_ALBUM_DETAILS: Record<string, AlbumDetail> = {
  'sample-album-001': {
    id: 'sample-album-001',
    title: 'Sample Album 001 (Fixture)',
    photos: [
      { id: 'fixture-photo-001', title: 'Fixture Photo 001' },
      { id: 'fixture-photo-002', title: 'Fixture Photo 002' },
      { id: 'fixture-photo-003', title: 'Fixture Photo 003 <Sample> & Test' },
    ],
  },
  'sample-album-002': {
    id: 'sample-album-002',
    title: 'Sample Album 002 (Fixture)',
    photos: [
      { id: 'fixture-photo-004', title: 'Fixture Photo 004' },
      { id: 'fixture-photo-005', title: 'Fixture Photo 005' },
    ],
  },
}

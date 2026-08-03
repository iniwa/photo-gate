import { describe, expect, it } from 'vitest'
import { aspectRatioClass, formatPhotoDateHeading, groupPhotosByDate, validDimension } from '../src/services/viewer-photo-presentation.js'

const photo = (id: string, takenAt: string, width = 3000, height = 2000) => ({ id, title: id, thumb: '', preview: '', takenAt, width, height })

describe('viewer photo presentation helpers', () => {
  it('groups contiguous local dates without sorting', () => {
    const groups = groupPhotosByDate([photo('a', '2026-05-01T12:00:00+09:00'), photo('b', '2026-05-01T13:00:00+09:00'), photo('c', '2026-05-02T12:00:00+09:00'), photo('d', '2026-05-01T14:00:00+09:00')])
    expect(groups.map((group) => group.photos.map((item) => item.id))).toEqual([['a', 'b'], ['c'], ['d']])
  })
  it('formats years only when spanning years and handles invalid dates', () => {
    expect(formatPhotoDateHeading('2026-05-01')).toContain('5月1日')
    expect(formatPhotoDateHeading('2026-05-01', true)).toContain('2026年')
    expect(formatPhotoDateHeading(null)).toBe('日付不明')
    expect(groupPhotosByDate([photo('a', '2026-02-29T00:00:00Z')])[0]?.heading).toBe('日付不明')
    expect(groupPhotosByDate([photo('a', '2024-02-29T00:00:00Z')])[0]?.heading).toContain('2月29日')
    expect(groupPhotosByDate([photo('a', '2024-02-29T00:00:00Z'), photo('b', '2025-03-01T00:00:00Z')]).every((group) => group.heading.includes('年'))).toBe(true)
    expect(groupPhotosByDate([photo('a', undefined as unknown as string)])[0]?.heading).toBe('日付不明')
    expect(groupPhotosByDate([photo('a', '2026-05-01Tgarbage')])[0]?.heading).toBe('日付不明')
  })
  it('maps aspect ratios to clamped static classes', () => {
    expect(aspectRatioClass(3000, 2000)).toBe('ar-150')
    expect(aspectRatioClass(105, 100)).toBe('ar-110')
    expect(aspectRatioClass(1, 10)).toBe('ar-050')
    expect(aspectRatioClass(10, 1)).toBe('ar-240')
    expect(aspectRatioClass(0, 1)).toBe('ar-100')
    expect(aspectRatioClass(1.5, 1)).toBe('ar-100')
    expect(aspectRatioClass(Number.NaN, 1)).toBe('ar-100')
    expect(validDimension(1)).toBe(true)
    expect(validDimension(1.5)).toBe(false)
    expect(validDimension(Number.MAX_SAFE_INTEGER + 1)).toBe(false)
    for (let index = 50; index <= 240; index += 10) {
      expect(aspectRatioClass(index, 100)).toBe(`ar-${String(index).padStart(3, '0')}`)
    }
  })
})

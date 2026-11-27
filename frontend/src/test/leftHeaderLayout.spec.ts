import { describe, expect, it } from 'vitest'
import {
  actionIsInline,
  hiddenTreeActions,
  leftHeaderTier,
  type LeftHeaderTier,
} from '../components/workspace/leftHeaderLayout'

describe('leftHeaderTier', () => {
  it('treats an unmeasured header as full', () => {
    expect(leftHeaderTier(0)).toBe('full')
    expect(leftHeaderTier(Number.NaN)).toBe('full')
  })

  it('keeps every action inline at 270px and above', () => {
    expect(leftHeaderTier(270)).toBe('full')
    expect(leftHeaderTier(320)).toBe('full')
  })

  it('moves the trailing actions into the menu between 210 and 269', () => {
    expect(leftHeaderTier(269)).toBe('compact')
    expect(leftHeaderTier(210)).toBe('compact')
  })

  it('also hides search and upload between 170 and 209', () => {
    expect(leftHeaderTier(209)).toBe('tight')
    expect(leftHeaderTier(170)).toBe('tight')
  })

  it('hides refresh below 170', () => {
    expect(leftHeaderTier(169)).toBe('tiny')
    expect(leftHeaderTier(120)).toBe('tiny')
  })
})

describe('hiddenTreeActions', () => {
  const hidden = (tier: LeftHeaderTier) => hiddenTreeActions(tier)

  it('hides nothing in full', () => {
    expect(hidden('full')).toEqual([])
  })

  it('hides the creation and collapse actions in compact', () => {
    expect(hidden('compact')).toEqual(['new-file', 'new-folder', 'collapse'])
  })

  it('adds search and upload in tight', () => {
    expect(hidden('tight')).toEqual(['search', 'new-file', 'new-folder', 'upload', 'collapse'])
  })

  it('adds refresh in tiny', () => {
    expect(hidden('tiny')).toEqual([
      'search',
      'new-file',
      'new-folder',
      'upload',
      'refresh',
      'collapse',
    ])
  })

  it('keeps upload inline in compact', () => {
    expect(hidden('compact')).not.toContain('upload')
  })

  it('matches actionIsInline', () => {
    for (const tier of ['full', 'compact', 'tight', 'tiny'] as const) {
      const hiddenActions = hidden(tier)
      for (const action of [
        'search',
        'new-file',
        'new-folder',
        'upload',
        'refresh',
        'collapse',
      ] as const) {
        expect(actionIsInline(tier, action)).toBe(!hiddenActions.includes(action))
      }
    }
  })
})

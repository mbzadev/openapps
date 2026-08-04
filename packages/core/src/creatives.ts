import { z } from 'zod'

export const adSourceSchema = z.enum(['meta', 'google', 'tiktok'])
export type AdSource = z.infer<typeof adSourceSchema>

export const adMediaSchema = z.object({
  sourceUrl: z.url(),
  mediaType: z.enum(['image', 'video', 'thumbnail']),
  role: z.enum(['primary', 'thumbnail', 'carousel']).default('primary'),
  position: z.number().int().nonnegative().default(0),
  mimeType: z.string().optional(),
})

export const adVariantSchema = z.object({
  sourceVariantId: z.string().nullable().default(null),
  format: z.enum(['image', 'video', 'carousel', 'text', 'unknown']).default('unknown'),
  headline: z.string().nullable().default(null),
  body: z.string().nullable().default(null),
  callToAction: z.string().nullable().default(null),
  landingUrl: z.url().nullable().default(null),
  position: z.number().int().nonnegative().default(0),
  media: z.array(adMediaSchema).default([]),
})

const rangeSchema = z.object({ min: z.number().nonnegative().nullable(), max: z.number().nonnegative().nullable() }).nullable().default(null)

export const adCreativeRecordSchema = z.object({
  source: adSourceSchema,
  sourceAdId: z.string().min(1),
  sourceUrl: z.url().nullable().default(null),
  advertiser: z.object({ sourceId: z.string().nullable().default(null), name: z.string().min(1), domain: z.string().nullable().default(null), sourceUrl: z.url().nullable().default(null) }),
  status: z.enum(['active', 'inactive', 'removed', 'unknown']).default('unknown'),
  headline: z.string().nullable().default(null),
  body: z.string().nullable().default(null),
  callToAction: z.string().nullable().default(null),
  landingUrl: z.url().nullable().default(null),
  platforms: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  countries: z.array(z.string().length(2)).default([]),
  startedAt: z.string().nullable().default(null),
  endedAt: z.string().nullable().default(null),
  impressions: rangeSchema,
  reach: rangeSchema,
  spend: rangeSchema,
  currency: z.string().nullable().default(null),
  variants: z.array(adVariantSchema).default([]),
  raw: z.unknown(),
})

export type AdCreativeRecord = z.infer<typeof adCreativeRecordSchema>

export function normalizeAdvertiserAlias(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

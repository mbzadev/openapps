import { z } from 'zod'

export const platformSchema = z.enum(['ios', 'android'])
export type Platform = z.infer<typeof platformSchema>

export function chartTaskId(
  platform: Platform,
  countryCode: string,
  collection: 'top_free' | 'top_paid' | 'top_grossing',
  categoryExternalId: string | null,
  snapshotDate: string,
) {
  return `chart:v2:${platform}:${countryCode}:${collection}:${categoryExternalId ?? 'root'}:${snapshotDate}`
}

export const jobMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    v: z.literal(1),
    kind: z.literal('app.sync'),
    platform: platformSchema,
    appId: z.number().int().positive(),
    source: z.enum(['scheduled', 'on-demand', 'reconcile']),
    taskId: z.string().min(1),
  }),
  z.object({
    v: z.literal(1),
    kind: z.literal('app.storefront'),
    platform: platformSchema,
    appId: z.number().int().positive(),
    countryCode: z.string().length(2),
    locale: z.string().min(1).max(20),
    source: z.enum(['scheduled', 'on-demand', 'reconcile']),
    taskId: z.string().min(1),
  }),
  z.object({
    v: z.literal(1),
    kind: z.literal('chart.sync'),
    platform: platformSchema,
    countryCode: z.string().length(2),
    collection: z.enum(['top_free', 'top_paid', 'top_grossing']),
    categoryExternalId: z.string().nullable(),
    snapshotDate: z.string(),
    taskId: z.string().min(1),
  }),
  z.object({
    v: z.literal(1),
    kind: z.literal('sync.reconcile'),
    syncStatusId: z.number().int().positive(),
    taskId: z.string().min(1),
  }),
  z.object({
    v: z.literal(1),
    kind: z.literal('dead-letter'),
    original: z.unknown(),
    error: z.string(),
    failedAt: z.string(),
    taskId: z.string().min(1),
  }),
])

export type JobMessage = z.infer<typeof jobMessageSchema>

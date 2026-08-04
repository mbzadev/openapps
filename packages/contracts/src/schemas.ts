import { z } from 'zod/v4'

export const platform = z.enum(['ios', 'android'])
export const folderColor = z.enum(['slate', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'])
export const registerRequest = z.object({ name: z.string().min(1).max(255), email: z.email(), password: z.string().min(8), password_confirmation: z.string() })
export const loginRequest = z.object({ email: z.email(), password: z.string() })
export const profileUpdateRequest = z.object({ name: z.string().min(1).max(255), email: z.email().max(255) })
export const profileDeleteRequest = z.object({ password: z.string() })
export const passwordUpdateRequest = z.object({ current_password: z.string(), password: z.string().min(8), password_confirmation: z.string() })
export const apiTokenCreateRequest = z.object({ name: z.string().min(1).max(255), abilities: z.array(z.string()).optional() })
export const folderCreateRequest = z.object({ name: z.string().min(1).max(255), color: folderColor, sort_order: z.number().int().optional() })
export const folderUpdateRequest = z.object({ name: z.string().min(1).max(255).optional(), color: folderColor.optional(), sort_order: z.number().int().optional() })
export const appIdentity = z.object({ platform, external_id: z.string().min(1) })
export const moveToFolderRequest = z.object({ folder_id: z.number().int().positive().nullable() })
export const competitorCreateRequest = z.object({
  competitor_app_id: z.number().int().positive().optional(), competitor_platform: platform.optional(),
  competitor_external_id: z.string().min(1).optional(), relationship: z.enum(['direct', 'indirect', 'aspiration']).optional(),
}).refine((value) => value.competitor_app_id !== undefined || value.competitor_external_id !== undefined)
export const publisherImportRequest = z.object({ external_ids: z.array(z.string().min(1)).min(1).max(50) })
export const errorResponse = z.object({ message: z.string(), errors: z.record(z.string(), z.array(z.string())).optional() })
export const user = z.object({ id: z.number().int(), name: z.string(), email: z.email(), email_verified_at: z.string().nullable(), created_at: z.string(), updated_at: z.string() })
export const appResource = z.object({ id: z.number().int(), name: z.string(), platform, external_id: z.string(), icon_url: z.string().nullable(), rating: z.number().nullable(), rating_count: z.number().int().nullable(), version: z.string().nullable(), is_available: z.boolean(), is_tracked: z.boolean() }).passthrough()
export const creativeSource = z.enum(['meta', 'google', 'tiktok'])
export const creativeResource = z.object({
  id: z.number().int(), source: creativeSource, source_ad_id: z.string(), source_url: z.string().nullable(),
  status: z.enum(['active', 'inactive', 'removed', 'unknown']),
  advertiser: z.object({ id: z.number().int(), name: z.string(), domain: z.string().nullable() }).nullable(),
  headline: z.string().nullable(), body: z.string().nullable(), call_to_action: z.string().nullable(), landing_url: z.string().nullable(),
  platforms: z.array(z.string()), languages: z.array(z.string()), started_at: z.string().nullable(), ended_at: z.string().nullable(),
  preview: z.object({ url: z.string(), type: z.enum(['image', 'video', 'thumbnail']), mime_type: z.string() }).nullable(),
  variants_count: z.number().int(), apps_count: z.number().int(),
  provenance: z.object({ source: creativeSource, collected_at: z.string(), raw_archived: z.boolean() }),
  first_collected_at: z.string(), last_collected_at: z.string(),
}).passthrough()
export const creativePage = z.object({
  data: z.array(creativeResource), links: z.object({ prev: z.string().nullable(), next: z.string().nullable() }),
  meta: z.object({ current_page: z.number().int(), last_page: z.number().int(), per_page: z.number().int(), total: z.number().int() }),
  coverage: z.record(creativeSource, z.object({ status: z.string(), last_collected_at: z.string().nullable() })),
})
export const creativeSyncResponse = z.object({ status: z.enum(['queued', 'running']), target_id: z.number().int() })

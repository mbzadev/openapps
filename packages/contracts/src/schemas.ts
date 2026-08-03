import { z } from 'zod/v4'

export const platform = z.enum(['ios', 'android'])
export const registerRequest = z.object({ name: z.string().min(1).max(255), email: z.email(), password: z.string().min(8), password_confirmation: z.string() })
export const loginRequest = z.object({ email: z.email(), password: z.string() })
export const appIdentity = z.object({ platform, external_id: z.string().min(1) })
export const errorResponse = z.object({ message: z.string(), errors: z.record(z.string(), z.array(z.string())).optional() })
export const user = z.object({ id: z.number().int(), name: z.string(), email: z.email(), created_at: z.string(), updated_at: z.string() })
export const appResource = z.object({ id: z.number().int(), name: z.string(), platform, external_id: z.string(), icon_url: z.string().nullable(), rating: z.number().nullable(), rating_count: z.number().int().nullable(), version: z.string().nullable(), is_available: z.boolean(), is_tracked: z.boolean() }).passthrough()

import config from '@payload-config'
import { getPayload, type Payload } from 'payload'

type StaffUser = { id: number; collection?: string; role?: 'super-admin' | 'operator' }

export async function requireOperator(request: Request): Promise<{ payload: Payload; user: StaffUser } | Response> {
  const payload = await getPayload({ config })
  const result = await payload.auth({ headers: request.headers })
  const user = result.user as StaffUser | null
  if (!user || user.collection !== 'staff' || !['super-admin', 'operator'].includes(user.role ?? '')) {
    return Response.json({ message: 'Forbidden' }, { status: 403 })
  }
  return { payload, user }
}

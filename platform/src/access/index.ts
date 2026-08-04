import type { Access, PayloadRequest } from 'payload'

export type StaffRole = 'super-admin' | 'operator'

type StaffLike = { collection?: string; role?: StaffRole } | null | undefined

export function staffFrom(req: PayloadRequest): StaffLike {
  return req.user as StaffLike
}

export const isStaff: Access = ({ req }) => staffFrom(req)?.collection === 'staff'
export const isSuperAdmin: Access = ({ req }) => staffFrom(req)?.collection === 'staff' && staffFrom(req)?.role === 'super-admin'

export const createFirstStaffOrSuperAdmin: Access = async ({ req }) => {
  if (staffFrom(req)?.collection === 'staff' && staffFrom(req)?.role === 'super-admin') return true
  if (req.user) return false
  const { totalDocs } = await req.payload.count({ collection: 'staff', overrideAccess: true })
  return totalDocs === 0
}

export function canOperate(req: PayloadRequest): boolean {
  const user = staffFrom(req)
  return user?.collection === 'staff' && (user.role === 'operator' || user.role === 'super-admin')
}

export const staffReadOnly = {
  create: isSuperAdmin,
  delete: isSuperAdmin,
  read: isStaff,
  update: isSuperAdmin,
} as const

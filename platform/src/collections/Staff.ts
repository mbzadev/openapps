import type { CollectionConfig } from 'payload'
import { createFirstStaffOrSuperAdmin, isSuperAdmin } from '@/access'

export const Staff: CollectionConfig = {
  slug: 'staff',
  dbName: 'payload_staff',
  auth: {
    cookies: { sameSite: 'Lax', secure: true },
    maxLoginAttempts: 5,
    lockTime: 15 * 60 * 1000,
    tokenExpiration: 2 * 60 * 60,
    useSessions: true,
  },
  access: {
    create: createFirstStaffOrSuperAdmin,
    delete: isSuperAdmin,
    read: ({ req }) => req.user?.collection === 'staff',
    update: ({ req, id }) => req.user?.collection === 'staff' && (req.user.id === id || req.user.role === 'super-admin'),
  },
  admin: {
    group: 'Administration',
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'role', 'updatedAt'],
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'operator',
      options: [
        { label: 'Super administrateur', value: 'super-admin' },
        { label: 'Opérateur', value: 'operator' },
      ],
      saveToJWT: true,
    },
  ],
}

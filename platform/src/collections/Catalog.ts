import type { CollectionConfig, Field } from 'payload'
import { staffReadOnly } from '@/access'

const hiddenHash: Field = {
  name: 'passwordHash',
  type: 'text',
  access: { read: () => false, create: () => false, update: () => false },
  admin: { hidden: true },
  required: true,
}

export const Members: CollectionConfig = {
  slug: 'members',
  dbName: 'users',
  access: staffReadOnly,
  admin: { group: 'Comptes', useAsTitle: 'email', defaultColumns: ['name', 'email', 'emailVerifiedAt', 'updatedAt'] },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'email', type: 'email', required: true, unique: true, index: true },
    { name: 'emailVerifiedAt', type: 'date' },
    hiddenHash,
  ],
}

export const Countries: CollectionConfig = {
  slug: 'countries',
  dbName: 'payload_countries',
  access: staffReadOnly,
  admin: { group: 'Catalogue', useAsTitle: 'name', defaultColumns: ['name', 'id', 'isActiveIos', 'isActiveAndroid', 'priority'] },
  fields: [
    { name: 'id', type: 'text', required: true },
    { name: 'name', type: 'text', required: true },
    { name: 'emoji', type: 'text', defaultValue: '' },
    { name: 'isActiveIos', type: 'checkbox', defaultValue: false },
    { name: 'isActiveAndroid', type: 'checkbox', defaultValue: false },
    { name: 'iosLanguages', type: 'json', defaultValue: [] },
    { name: 'androidLanguages', type: 'json', defaultValue: [] },
    { name: 'priority', type: 'number', defaultValue: 0, index: true },
  ],
}

export const StoreCategories: CollectionConfig = {
  slug: 'store-categories',
  dbName: 'store_categories',
  access: staffReadOnly,
  admin: { group: 'Catalogue', useAsTitle: 'name', defaultColumns: ['name', 'platform', 'externalId', 'type'] },
  fields: [
    { name: 'platform', type: 'select', required: true, options: ['ios', 'android'], index: true },
    { name: 'externalId', type: 'text', index: true },
    { name: 'name', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true },
    { name: 'type', type: 'select', required: true, options: ['app', 'game', 'magazine'] },
    { name: 'parent', type: 'relationship', relationTo: 'store-categories' },
    { name: 'priority', type: 'number', defaultValue: 0 },
  ],
}

export const Publishers: CollectionConfig = {
  slug: 'publishers',
  dbName: 'publishers',
  access: staffReadOnly,
  admin: { group: 'Catalogue', useAsTitle: 'name', defaultColumns: ['name', 'platform', 'externalId', 'updatedAt'] },
  fields: [
    { name: 'platform', type: 'select', required: true, options: ['ios', 'android'], index: true },
    { name: 'externalId', type: 'text', required: true, index: true },
    { name: 'name', type: 'text', required: true, index: true },
    { name: 'url', type: 'text' },
  ],
}

export const Apps: CollectionConfig = {
  slug: 'catalog-apps',
  dbName: 'apps',
  access: staffReadOnly,
  admin: { group: 'Catalogue', useAsTitle: 'displayName', defaultColumns: ['displayName', 'platform', 'externalId', 'lastSyncedAt', 'isAvailable'] },
  fields: [
    { name: 'platform', type: 'select', required: true, options: ['ios', 'android'], index: true },
    { name: 'externalId', type: 'text', required: true, index: true },
    { name: 'publisher', type: 'relationship', relationTo: 'publishers' },
    { name: 'category', type: 'relationship', relationTo: 'store-categories' },
    { name: 'displayName', type: 'text', required: true, index: true },
    { name: 'iconUrl', type: 'text' },
    { name: 'originCountryCode', type: 'text', required: true, defaultValue: 'us' },
    { name: 'supportedLocales', type: 'json', defaultValue: [] },
    { name: 'originalReleaseDate', type: 'date' },
    { name: 'isFree', type: 'checkbox', defaultValue: true },
    { name: 'discoveredFrom', type: 'text', required: true, defaultValue: 'unknown' },
    { name: 'discoveredAt', type: 'date', required: true },
    { name: 'lastSyncedAt', type: 'date', index: true },
    { name: 'isAvailable', type: 'checkbox', defaultValue: true },
  ],
}

export const AppVersions: CollectionConfig = {
  slug: 'app-versions',
  dbName: 'app_versions',
  access: staffReadOnly,
  admin: { group: 'Catalogue', useAsTitle: 'version', defaultColumns: ['app', 'version', 'releaseDate', 'updatedAt'] },
  fields: [
    { name: 'app', type: 'relationship', relationTo: 'catalog-apps', required: true, index: true },
    { name: 'version', type: 'text', required: true },
    { name: 'releaseDate', type: 'date' },
    { name: 'whatsNew', type: 'textarea' },
    { name: 'fileSizeBytes', type: 'number' },
  ],
}

export const AppListings: CollectionConfig = {
  slug: 'app-listings',
  dbName: 'app_store_listings',
  access: staffReadOnly,
  admin: { group: 'Catalogue', useAsTitle: 'title', defaultColumns: ['title', 'app', 'locale', 'fetchedAt'] },
  fields: [
    { name: 'app', type: 'relationship', relationTo: 'catalog-apps', required: true, index: true },
    { name: 'version', type: 'relationship', relationTo: 'app-versions' },
    { name: 'locale', type: 'text', required: true, index: true },
    { name: 'title', type: 'text', required: true },
    { name: 'subtitle', type: 'text' },
    { name: 'promotionalText', type: 'textarea' },
    { name: 'description', type: 'textarea', required: true },
    { name: 'whatsNew', type: 'textarea' },
    { name: 'screenshots', type: 'json', defaultValue: [] },
    { name: 'iconUrl', type: 'text' },
    { name: 'videoUrl', type: 'text' },
    { name: 'price', type: 'number', defaultValue: 0 },
    { name: 'currency', type: 'text' },
    { name: 'fetchedAt', type: 'date', required: true },
    { name: 'checksum', type: 'text', required: true },
  ],
}

export const AppMetrics: CollectionConfig = {
  slug: 'app-metrics',
  dbName: 'app_metrics',
  access: staffReadOnly,
  admin: { group: 'Analyses', useAsTitle: 'date', defaultColumns: ['app', 'countryCode', 'date', 'rating', 'ratingCount'] },
  fields: [
    { name: 'app', type: 'relationship', relationTo: 'catalog-apps', required: true, index: true },
    { name: 'version', type: 'relationship', relationTo: 'app-versions' },
    { name: 'countryCode', type: 'text', required: true, index: true },
    { name: 'date', type: 'date', required: true, index: true },
    { name: 'rating', type: 'number', defaultValue: 0 },
    { name: 'ratingCount', type: 'number', defaultValue: 0 },
    { name: 'ratingBreakdown', type: 'json' },
    { name: 'isAvailable', type: 'checkbox', defaultValue: true },
  ],
}

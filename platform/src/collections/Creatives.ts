import type { CollectionConfig } from 'payload'
import { isStaff, isSuperAdmin, staffReadOnly } from '@/access'

export const Advertisers: CollectionConfig = {
  slug: 'ad-advertisers',
  dbName: 'ad_advertisers',
  access: staffReadOnly,
  admin: { group: 'Créatifs', useAsTitle: 'name', defaultColumns: ['name', 'source', 'domain', 'updatedAt'] },
  fields: [
    { name: 'source', type: 'select', options: ['meta', 'google', 'tiktok'], required: true, index: true },
    { name: 'sourceAdvertiserId', type: 'text', index: true },
    { name: 'name', type: 'text', required: true, index: true },
    { name: 'domain', type: 'text', index: true },
    { name: 'sourceUrl', type: 'text' },
  ],
}

export const Ads: CollectionConfig = {
  slug: 'ads',
  dbName: 'ads',
  access: staffReadOnly,
  admin: { group: 'Créatifs', useAsTitle: 'sourceAdId', defaultColumns: ['sourceAdId', 'source', 'advertiser', 'status', 'lastCollectedAt'] },
  fields: [
    { name: 'source', type: 'select', options: ['meta', 'google', 'tiktok'], required: true, index: true },
    { name: 'sourceAdId', type: 'text', required: true, index: true },
    { name: 'advertiser', type: 'relationship', relationTo: 'ad-advertisers' },
    { name: 'sourceUrl', type: 'text' },
    { name: 'status', type: 'select', options: ['active', 'inactive', 'removed', 'unknown'], defaultValue: 'unknown', index: true },
    { name: 'headline', type: 'text' },
    { name: 'body', type: 'textarea' },
    { name: 'callToAction', type: 'text' },
    { name: 'landingUrl', type: 'text' },
    { name: 'platforms', type: 'json', defaultValue: [] },
    { name: 'languages', type: 'json', defaultValue: [] },
    { name: 'startedAt', type: 'date' },
    { name: 'endedAt', type: 'date' },
    { name: 'impressionsMin', type: 'number' },
    { name: 'impressionsMax', type: 'number' },
    { name: 'reachMin', type: 'number' },
    { name: 'reachMax', type: 'number' },
    { name: 'spendMin', type: 'number' },
    { name: 'spendMax', type: 'number' },
    { name: 'currency', type: 'text' },
    { name: 'firstCollectedAt', type: 'date', required: true },
    { name: 'lastCollectedAt', type: 'date', required: true, index: true },
    { name: 'rawR2Key', type: 'text' },
  ],
}

export const AdAssets: CollectionConfig = {
  slug: 'ad-assets',
  dbName: 'ad_assets',
  access: staffReadOnly,
  admin: { group: 'Créatifs', useAsTitle: 'sha256', defaultColumns: ['sha256', 'mediaType', 'mimeType', 'byteSize', 'createdAt'] },
  fields: [
    { name: 'sha256', type: 'text', required: true, unique: true, index: true },
    { name: 'r2Key', type: 'text', required: true, unique: true },
    { name: 'mediaType', type: 'select', options: ['image', 'video', 'thumbnail'], required: true, index: true },
    { name: 'mimeType', type: 'text', required: true },
    { name: 'byteSize', type: 'number', required: true },
    { name: 'width', type: 'number' },
    { name: 'height', type: 'number' },
    { name: 'durationMs', type: 'number' },
    { name: 'originalUrl', type: 'text' },
  ],
}

export const AdAppLinks: CollectionConfig = {
  slug: 'ad-app-links',
  dbName: 'ad_app_links',
  access: {
    create: ({ req }) => req.user?.collection === 'staff',
    delete: ({ req }) => req.user?.collection === 'staff',
    read: isStaff,
    update: ({ req }) => req.user?.collection === 'staff',
  },
  admin: { group: 'Créatifs', useAsTitle: 'matchReason', defaultColumns: ['ad', 'app', 'candidateName', 'confidence', 'matchReason'] },
  fields: [
    { name: 'ad', type: 'relationship', relationTo: 'ads', required: true, index: true },
    { name: 'app', type: 'relationship', relationTo: 'catalog-apps', index: true },
    { name: 'candidateName', type: 'text' },
    { name: 'confidence', type: 'select', options: ['certain', 'strong', 'candidate'], required: true, index: true },
    { name: 'matchReason', type: 'text', required: true },
    { name: 'verified', type: 'checkbox', defaultValue: false },
    { name: 'verifiedBy', type: 'relationship', relationTo: 'staff' },
  ],
}

export const PayloadMedia: CollectionConfig = {
  slug: 'payload-media',
  dbName: 'payload_media',
  access: { create: isSuperAdmin, delete: isSuperAdmin, read: isStaff, update: isSuperAdmin },
  admin: { group: 'Administration', useAsTitle: 'alt' },
  fields: [{ name: 'alt', type: 'text', required: true }],
  upload: { crop: false, focalPoint: false },
}

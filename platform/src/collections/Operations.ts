import type { CollectionConfig } from 'payload'
import { canOperate, isStaff, isSuperAdmin, staffReadOnly } from '@/access'

const sourceOptions = [
  { label: 'Apple Store', value: 'apple' },
  { label: 'Google Play', value: 'google-play' },
  { label: 'Meta Ads', value: 'meta' },
  { label: 'Google Ads', value: 'google' },
  { label: 'TikTok Ads', value: 'tiktok' },
]

export const ConnectorConfigs: CollectionConfig = {
  slug: 'connector-configs',
  dbName: 'payload_connector_configs',
  access: {
    create: isSuperAdmin,
    delete: isSuperAdmin,
    read: isStaff,
    update: ({ req }) => canOperate(req),
  },
  admin: {
    group: 'Exploitation',
    useAsTitle: 'label',
    defaultColumns: ['label', 'source', 'enabled', 'health', 'lastSuccessAt', 'updatedAt'],
  },
  fields: [
    { name: 'label', type: 'text', required: true },
    { name: 'source', type: 'select', options: sourceOptions, required: true, unique: true, index: true },
    { name: 'enabled', type: 'checkbox', defaultValue: true, index: true },
    { name: 'transport', type: 'select', required: true, options: ['fetch', 'api', 'browser-rendering'] },
    { name: 'capabilities', type: 'select', hasMany: true, options: ['lookup', 'search', 'charts', 'creatives', 'media'] },
    { name: 'countries', type: 'json', defaultValue: [] },
    { name: 'requestsPerMinute', type: 'number', min: 1, defaultValue: 2 },
    { name: 'concurrency', type: 'number', min: 1, max: 20, defaultValue: 2 },
    { name: 'health', type: 'select', options: ['unknown', 'healthy', 'limited', 'failing', 'disabled'], defaultValue: 'unknown', index: true },
    { name: 'lastHealthCode', type: 'text' },
    { name: 'lastSuccessAt', type: 'date' },
    { name: 'lastFailureAt', type: 'date' },
    { name: 'circuitOpenUntil', type: 'date' },
    { name: 'secretStatus', type: 'select', options: ['not-required', 'configured', 'missing', 'expired'], defaultValue: 'not-required' },
    { name: 'notes', type: 'textarea' },
  ],
}

export const SyncTasks: CollectionConfig = {
  slug: 'sync-tasks',
  dbName: 'sync_tasks',
  access: staffReadOnly,
  admin: { group: 'Exploitation', useAsTitle: 'taskId', defaultColumns: ['taskId', 'kind', 'status', 'attemptCount', 'availableAt', 'updatedAt'] },
  fields: [
    { name: 'syncStatusId', type: 'number', index: true },
    { name: 'taskId', type: 'text', required: true, unique: true, index: true },
    { name: 'kind', type: 'text', required: true, index: true },
    { name: 'payload', type: 'json', required: true },
    { name: 'status', type: 'select', options: ['pending', 'running', 'retrying', 'completed', 'failed', 'dead-letter'], defaultValue: 'pending', index: true },
    { name: 'attemptCount', type: 'number', defaultValue: 0 },
    { name: 'failureReason', type: 'text' },
    { name: 'errorMessage', type: 'textarea' },
    { name: 'availableAt', type: 'date', index: true },
  ],
}

export const TaskAttempts: CollectionConfig = {
  slug: 'task-attempts',
  dbName: 'payload_task_attempts',
  access: staffReadOnly,
  admin: { group: 'Exploitation', useAsTitle: 'taskId', defaultColumns: ['taskId', 'attempt', 'status', 'durationMs', 'startedAt'] },
  fields: [
    { name: 'taskId', type: 'text', required: true, index: true },
    { name: 'attempt', type: 'number', required: true },
    { name: 'status', type: 'select', options: ['running', 'completed', 'failed', 'retrying'], required: true, index: true },
    { name: 'source', type: 'text', index: true },
    { name: 'startedAt', type: 'date', required: true, index: true },
    { name: 'completedAt', type: 'date' },
    { name: 'durationMs', type: 'number' },
    { name: 'resultCount', type: 'number' },
    { name: 'errorCode', type: 'text' },
    { name: 'errorMessage', type: 'textarea' },
    { name: 'rawR2Key', type: 'text' },
  ],
}

export const CollectionRuns: CollectionConfig = {
  slug: 'collection-runs',
  dbName: 'ad_collection_runs',
  access: staffReadOnly,
  admin: { group: 'Exploitation', useAsTitle: 'source', defaultColumns: ['source', 'reason', 'status', 'resultCount', 'startedAt', 'completedAt'] },
  fields: [
    { name: 'targetId', type: 'number', required: true, index: true },
    { name: 'source', type: 'select', options: ['meta', 'google', 'tiktok'], required: true, index: true },
    { name: 'reason', type: 'text', required: true },
    { name: 'status', type: 'select', options: ['running', 'completed', 'partial', 'failed', 'skipped'], required: true, index: true },
    { name: 'resultCount', type: 'number', defaultValue: 0 },
    { name: 'newAdCount', type: 'number', defaultValue: 0 },
    { name: 'linkedAppCount', type: 'number', defaultValue: 0 },
    { name: 'candidateCount', type: 'number', defaultValue: 0 },
    { name: 'errorMessage', type: 'textarea' },
    { name: 'rawR2Key', type: 'text' },
    { name: 'startedAt', type: 'date', required: true, index: true },
    { name: 'completedAt', type: 'date' },
  ],
}

export const DeadLetters: CollectionConfig = {
  slug: 'dead-letters',
  dbName: 'payload_dead_letters',
  access: staffReadOnly,
  admin: { group: 'Exploitation', useAsTitle: 'taskId', defaultColumns: ['taskId', 'kind', 'source', 'status', 'failedAt'] },
  fields: [
    { name: 'taskId', type: 'text', required: true, unique: true, index: true },
    { name: 'kind', type: 'text', required: true, index: true },
    { name: 'source', type: 'text', index: true },
    { name: 'status', type: 'select', options: ['open', 'requeued', 'resolved'], defaultValue: 'open', index: true },
    { name: 'attemptCount', type: 'number', required: true },
    { name: 'errorCode', type: 'text' },
    { name: 'errorMessage', type: 'textarea', required: true },
    { name: 'payload', type: 'json', required: true },
    { name: 'rawR2Key', type: 'text' },
    { name: 'failedAt', type: 'date', required: true, index: true },
    { name: 'resolvedAt', type: 'date' },
    { name: 'resolvedBy', type: 'relationship', relationTo: 'staff' },
  ],
}

export const AuditLogs: CollectionConfig = {
  slug: 'audit-logs',
  dbName: 'payload_audit_logs',
  access: staffReadOnly,
  admin: { group: 'Administration', useAsTitle: 'action', defaultColumns: ['action', 'entityType', 'entityId', 'actor', 'createdAt'] },
  fields: [
    { name: 'actor', type: 'relationship', relationTo: 'staff' },
    { name: 'action', type: 'text', required: true, index: true },
    { name: 'entityType', type: 'text', required: true, index: true },
    { name: 'entityId', type: 'text', index: true },
    { name: 'metadata', type: 'json' },
    { name: 'ipAddress', type: 'text' },
  ],
}

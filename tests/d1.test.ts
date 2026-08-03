import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
let db: DatabaseSync

function seedUser(email = 'user@example.com') {
  return Number(db.prepare("INSERT INTO users(name,email,password_hash,created_at,updated_at) VALUES('User',?,'hash','now','now')").run(email).lastInsertRowid)
}

function seedApp(externalId = 'example.app', platform = 'ios') {
  return Number(db.prepare("INSERT INTO apps(platform,external_id,display_name,origin_country_code,discovered_from,discovered_at,created_at,updated_at) VALUES(?,?,?,'us','test','now','now','now')").run(platform, externalId, externalId).lastInsertRowid)
}

beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec(readFileSync(resolve(root, 'migrations/0001_initial.sql'), 'utf8'))
  db.exec(readFileSync(resolve(root, 'migrations/0002_seed.sql'), 'utf8'))
  db.exec(readFileSync(resolve(root, 'migrations/0003_drop_redundant_chart_entry_index.sql'), 'utf8'))
  db.exec(readFileSync(resolve(root, 'migrations/0004_dedupe_listing_changes.sql'), 'utf8'))
})
afterEach(() => db.close())

describe('D1 schema and reference data', () => {
  it('seeds the complete reference tables', () => {
    expect(db.prepare('SELECT count(*) AS n FROM countries').get()).toEqual({ n: 125 })
    expect(db.prepare('SELECT count(*) AS n FROM store_categories').get()).toEqual({ n: 100 })
  })
  it('enforces case-insensitive unique email addresses', () => {
    seedUser('Person@Example.com')
    expect(() => seedUser('person@example.com')).toThrow(/UNIQUE/)
  })
  it('enforces store platform values and app identity', () => {
    seedApp('same.id', 'ios')
    expect(() => seedApp('same.id', 'ios')).toThrow(/UNIQUE/)
    expect(() => seedApp('invalid.id', 'windows')).toThrow(/CHECK/)
  })
  it('allows one root category per platform through a partial unique index', () => {
    expect(() => db.prepare("INSERT INTO store_categories(platform,external_id,name,slug,type,created_at,updated_at) VALUES('ios',NULL,'Duplicate','duplicate','app','now','now')").run()).toThrow(/UNIQUE/)
  })
  it('deduplicates null-version listings through the functional index', () => {
    const appId = seedApp()
    const insert = db.prepare("INSERT INTO app_store_listings(app_id,version_id,locale,title,description,fetched_at,checksum,created_at,updated_at) VALUES(?,NULL,'en-US','Title','','now','sum','now','now')")
    insert.run(appId)
    expect(() => insert.run(appId)).toThrow(/UNIQUE/)
  })
  it('scopes folder names to each account', () => {
    const first = seedUser('one@example.com'), second = seedUser('two@example.com')
    const insert = db.prepare("INSERT INTO folders(user_id,name,created_at,updated_at) VALUES(?,'Watchlist','now','now')")
    insert.run(first); insert.run(second)
    expect(() => insert.run(first)).toThrow(/UNIQUE/)
  })
  it('rejects self-competitors and duplicate relationships', () => {
    const userId = seedUser(), appId = seedApp('one'), competitorId = seedApp('two')
    const insert = db.prepare("INSERT INTO app_competitors(user_id,app_id,competitor_app_id,created_at,updated_at) VALUES(?,?,?,'now','now')")
    expect(() => insert.run(userId, appId, appId)).toThrow(/CHECK/)
    insert.run(userId, appId, competitorId)
    expect(() => insert.run(userId, appId, competitorId)).toThrow(/UNIQUE/)
  })
  it('makes normalized queue tasks idempotent by task id', () => {
    const insert = db.prepare("INSERT INTO sync_tasks(task_id,kind,payload,created_at,updated_at) VALUES('task-1','app.sync','{}','now','now')")
    insert.run()
    expect(() => insert.run()).toThrow(/UNIQUE/)
  })
  it('cascades account deletion through sessions, folders, and tracking', () => {
    const userId = seedUser(), appId = seedApp()
    db.prepare("INSERT INTO personal_access_tokens(user_id,name,token_hash,created_at,updated_at) VALUES(?,'session','hash','now','now')").run(userId)
    db.prepare("INSERT INTO folders(user_id,name,created_at,updated_at) VALUES(?,'Folder','now','now')").run(userId)
    db.prepare("INSERT INTO user_apps(user_id,app_id,created_at) VALUES(?,?,'now')").run(userId, appId)
    db.prepare('DELETE FROM users WHERE id=?').run(userId)
    expect(db.prepare('SELECT count(*) AS n FROM personal_access_tokens').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM folders').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM user_apps').get()).toEqual({ n: 0 })
  })
  it('retains the retry lookup index used by reconciliation', () => {
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sync_tasks'").all().map((row) => row.name)
    expect(indexes).toContain('sync_tasks_retry_idx')
  })
  it('does not recreate the removed standalone chart-entry app index', () => {
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='trending_chart_entries'").all().map((row) => row.name)
    expect(indexes).not.toContain('trending_chart_entries_app_idx')
  })
})

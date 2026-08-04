import * as migration_20260804_223758_payload_initial from './20260804_223758_payload_initial';

export const migrations = [
  {
    up: migration_20260804_223758_payload_initial.up,
    down: migration_20260804_223758_payload_initial.down,
    name: '20260804_223758_payload_initial'
  },
];

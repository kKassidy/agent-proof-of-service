import { mkdir, open, readFile, access, link } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { FrozenServiceEvidence } from './phase4Types';

export interface Phase4Store {
  load(): Promise<unknown>;
  attempted(): Promise<boolean>;
  claim(): Promise<boolean>;
  freeze(evidence: FrozenServiceEvidence): Promise<void>;
}
export const phase4Directory = resolve(__dirname, '../../.runtime/phase4-job3');
const codeIs = (error: unknown, code: string) => !!error && typeof error === 'object' && 'code' in error && error.code === code;

// Only public run evidence is stored. An exclusive intent precedes HTTP; evidence
// is fsynced then published atomically without replacing any existing file.
export function createPhase4Store(directory = phase4Directory): Phase4Store {
  const intent = resolve(directory, 'attempt.json');
  const evidence = resolve(directory, 'evidence.json');
  const pending = resolve(directory, 'evidence.pending.json');
  async function syncDirectory(path: string) {
    const folder = await open(path, 'r');
    try { await folder.sync(); } finally { await folder.close(); }
  }
  async function writeOnce(path: string, value: unknown) {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync(); }
    finally { await file.close(); }
    await syncDirectory(directory);
  }
  return {
    async load() {
      try { return JSON.parse(await readFile(evidence, 'utf8')) as unknown; }
      catch (error) { if (codeIs(error, 'ENOENT')) return null; throw error; }
    },
    async attempted() {
      // An incomplete publication still means an HTTP request may have occurred,
      // even if the intent file was lost or removed independently.
      for (const path of [intent, pending, evidence]) {
        try { await access(path); return true; }
        catch (error) { if (!codeIs(error, 'ENOENT')) throw error; }
      }
      return false;
    },
    async claim() {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      // Persist directory entries too before allowing an external side effect.
      // All claimers sync the chain, including one racing with mkdir's creator.
      for (let path = resolve(directory); ; path = dirname(path)) {
        await syncDirectory(path);
        if (dirname(path) === path) break;
      }
      try { await writeOnce(intent, { jobId: '3', scenario: 'DETERMINISTIC_FAULT_INJECTION', startedAt: new Date().toISOString() }); return true; }
      catch (error) { if (codeIs(error, 'EEXIST')) return false; throw error; }
    },
    async freeze(value) {
      await writeOnce(pending, value);
      await link(pending, evidence);
      await syncDirectory(directory);
    },
  };
}

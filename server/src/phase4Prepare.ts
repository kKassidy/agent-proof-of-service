import { inspectPhase4, type Phase4Reader } from './phase4';
import { createPhase4Reader } from './phase4Rpc';
import { createPhase4Store, type Phase4Store } from './phase4Store';

// Read/simulate only. This entry point never executes the seller or starts Foundry.
export async function runPhase4Prepare(reader: Phase4Reader = createPhase4Reader(), store: Phase4Store = createPhase4Store(), stdout = console.log, stderr = console.error) {
  try {
    const evidence = await inspectPhase4(reader, store, { jobId: '3' }, 'prepare');
    stdout(JSON.stringify(evidence, null, 2));
    return evidence.prepared ? 0 : 1;
  } catch {
    stderr('Phase 4 preparation unavailable. Nothing sent. Preserve frozen evidence and inspect existing outcome activity.');
    return 1;
  }
}
if (require.main === module) void runPhase4Prepare().then(code => { process.exitCode = code; });

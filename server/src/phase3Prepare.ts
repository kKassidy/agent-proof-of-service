import { inspectPhase3, phase3Run, type Phase3Reader } from './phase3';
import { createPhase3Reader } from './phase3Rpc';

// Preparation only. Run again immediately before the operator's separate cast
// command. No account lookup, process spawning, password input or transaction.
export async function runPhase3Prepare(reader: Phase3Reader = createPhase3Reader(), stdout = console.log, stderr = console.error) {
  try {
    const evidence = await inspectPhase3(reader, { jobId: '3', paymentTransactionHash: phase3Run.paymentHash }, 'prepare');
    stdout(JSON.stringify(evidence, null, 2));
    return evidence.prepared ? 0 : 1;
  } catch {
    stderr('Phase 3 preparation unavailable. Nothing sent. Check registry state and existing transaction activity before continuing.');
    return 1;
  }
}
if (require.main === module) void runPhase3Prepare().then(code => { process.exitCode = code; });

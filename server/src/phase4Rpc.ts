import { createPublicClient, decodeEventLog, encodeFunctionData, http, parseAbiItem, zeroHash, type Hash } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { registryAbi, registryWriteAbi } from './registryAbi';
import { phase3Run, same, statsJson } from './phase3';
import { RegistryStatus, outcomeStatus } from './orchestration';
import type { Phase4Reader } from './phase4';

const outcomeEvent = parseAbiItem('event OutcomeRecorded(uint256 indexed jobId, uint8 outcome, bytes32 resultHash)');
export function createPhase4Reader(client = createPublicClient({ chain: avalancheFuji,
  transport: http(phase3Run.rpcUrl, { timeout: 8000, retryCount: 0 }) })): Phase4Reader {
  const address = phase3Run.registry;
  const jobAt = (blockNumber: bigint) => client.readContract({ address, abi: registryAbi, functionName: 'getJob', args: [3n], blockNumber });
  const validatorAt = (blockNumber: bigint) => client.readContract({ address, abi: registryAbi, functionName: 'validator', blockNumber });
  async function statsAt(blockNumber: bigint) {
    const [paidJobs, successfulJobs, failedJobs] = await client.readContract({ address, abi: registryAbi,
      functionName: 'sellerStats', args: [phase3Run.seller], blockNumber });
    return { paidJobs, successfulJobs, failedJobs };
  }
  return {
    payment: client,
    async snapshot() {
      const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
      const [job, validator, stats] = await Promise.all([jobAt(blockNumber), validatorAt(blockNumber), statsAt(blockNumber)]);
      return { blockNumber, job, validator, stats };
    },
    async simulate(snapshot, frozen) {
      await client.simulateContract({ address, abi: registryWriteAbi, functionName: 'recordOutcome',
        args: [3n, outcomeStatus(frozen.validation.result), frozen.resultHash], account: snapshot.validator, blockNumber: snapshot.blockNumber });
    },
    async outcome(snapshot, frozen, suppliedHash) {
      let hash: Hash | undefined = suppliedHash;
      if (!hash) {
        let end = snapshot.blockNumber;
        for (let page = 0; page < 4 && !hash; page++) {
          const start = end > 2047n ? end - 2047n : 0n;
          const logs = await client.getLogs({ address, event: outcomeEvent, args: { jobId: 3n }, fromBlock: start, toBlock: end });
          const matching = logs.filter(log => log.args.resultHash && same(log.args.resultHash, frozen.resultHash) && log.args.outcome === RegistryStatus.Failure);
          if (matching.length > 1) throw new Error('Ambiguous outcome');
          hash = matching[0]?.transactionHash ?? undefined;
          if (start === 0n) break;
          end = start - 1n;
        }
      }
      if (!hash) return null;
      const [receipt, tx] = await Promise.all([client.getTransactionReceipt({ hash }), client.getTransaction({ hash })]);
      if (!same(receipt.transactionHash, hash) || !same(tx.hash, hash) || receipt.status !== 'success' ||
          tx.chainId !== 43113 || tx.blockHash === null || tx.blockHash !== receipt.blockHash ||
          receipt.blockNumber > snapshot.blockNumber || receipt.blockNumber <= 0n ||
          !tx.to || !same(tx.to, address) || tx.value !== 0n ||
          tx.input !== encodeFunctionData({ abi: registryWriteAbi, functionName: 'recordOutcome', args: [3n, RegistryStatus.Failure, frozen.resultHash] })) throw new Error('Outcome transaction mismatch');
      const events = receipt.logs.filter(log => {
        if (!same(log.address, address)) return false;
        try {
          const event = decodeEventLog({ abi: [outcomeEvent], data: log.data, topics: log.topics, strict: true });
          return event.args.jobId === 3n && event.args.outcome === RegistryStatus.Failure && same(event.args.resultHash, frozen.resultHash);
        } catch { return false; }
      });
      const [beforeJob, afterJob, role, before, after] = await Promise.all([
        jobAt(receipt.blockNumber - 1n), jobAt(receipt.blockNumber), validatorAt(receipt.blockNumber),
        statsAt(receipt.blockNumber - 1n), statsAt(receipt.blockNumber),
      ]);
      if (events.length !== 1 || !same(tx.from, role) || beforeJob.status !== RegistryStatus.Paid || beforeJob.resultHash !== zeroHash ||
          beforeJob.completedAt !== 0n || afterJob.status !== RegistryStatus.Failure || !same(afterJob.resultHash, frozen.resultHash) ||
          afterJob.completedAt < afterJob.createdAt || afterJob.completedAt === 0n ||
          [beforeJob, afterJob].some(job => !same(job.paymentRef, phase3Run.paymentHash) || !same(job.taskHash, frozen.taskHash) ||
            !same(job.buyer, phase3Run.buyer) || !same(job.seller, phase3Run.seller))) throw new Error('Outcome transition mismatch');
      return { transactionHash: hash, blockNumber: receipt.blockNumber.toString(), receiptStatus: 'success',
        previousRegistryStatus: 'Paid', registryStatus: 'Failure', before: statsJson(before), after: statsJson(after),
        countersMatchExpectedDelta: after.paidJobs === before.paidJobs && after.successfulJobs === before.successfulJobs &&
          after.failedJobs === before.failedJobs + 1n };
    },
  };
}

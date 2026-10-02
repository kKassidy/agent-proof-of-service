import { createPublicClient, decodeEventLog, encodeFunctionData, http, parseAbiItem, zeroHash, type Hash } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { registryAbi, registryWriteAbi } from './registryAbi';
import { phase3Run, same, statsJson, type Phase3Reader, type Phase3Stats } from './phase3';

const paymentEvent = parseAbiItem('event PaymentConfirmed(uint256 indexed jobId, bytes32 paymentRef)');

export function createPhase3Reader(client = createPublicClient({ chain: avalancheFuji,
  transport: http(phase3Run.rpcUrl, { timeout: 8000, retryCount: 0 }) })): Phase3Reader {
  const address = phase3Run.registry;
  const jobAt = (blockNumber: bigint) => client.readContract({ address, abi: registryAbi, functionName: 'getJob', args: [3n], blockNumber });
  const confirmerAt = (blockNumber: bigint) => client.readContract({ address, abi: registryAbi, functionName: 'paymentConfirmer', blockNumber });
  async function statsAt(blockNumber: bigint): Promise<Phase3Stats> {
    const [paidJobs, successfulJobs, failedJobs] = await client.readContract({ address, abi: registryAbi,
      functionName: 'sellerStats', args: [phase3Run.seller], blockNumber });
    return { paidJobs, successfulJobs, failedJobs };
  }
  return {
    payment: client,
    async snapshot() {
      const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
      const [job, confirmer, stats] = await Promise.all([jobAt(blockNumber), confirmerAt(blockNumber), statsAt(blockNumber)]);
      return { blockNumber, job, confirmer, stats };
    },
    async simulate(snapshot, paymentRef) {
      // eth_call with an explicit authorized sender; never eth_sendTransaction.
      await client.simulateContract({ address, abi: registryWriteAbi, functionName: 'confirmPayment',
        args: [3n, paymentRef], account: snapshot.confirmer, blockNumber: snapshot.blockNumber });
    },
    async confirmation(snapshot, suppliedHash) {
      let hash: Hash | undefined = suppliedHash;
      if (!hash) {
        // Bounded recovery, never an unbounded genesis scan. Older confirmations
        // can always be recovered by supplying their public transaction hash.
        let end = snapshot.blockNumber;
        for (let page = 0; page < 4 && !hash; page++) {
          const start = end > 2047n ? end - 2047n : 0n;
          const logs = await client.getLogs({ address, event: paymentEvent, args: { jobId: 3n }, fromBlock: start, toBlock: end });
          const matching = logs.filter(log => log.args.paymentRef && same(log.args.paymentRef, phase3Run.paymentHash));
          if (matching.length > 1) throw new Error('Ambiguous confirmation');
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
          tx.input !== encodeFunctionData({ abi: registryWriteAbi, functionName: 'confirmPayment', args: [3n, phase3Run.paymentHash] })) throw new Error('Confirmation transaction mismatch');
      const events = receipt.logs.filter(log => {
        if (!same(log.address, address)) return false;
        try {
          const event = decodeEventLog({ abi: [paymentEvent], data: log.data, topics: log.topics, strict: true });
          return event.args.jobId === 3n && same(event.args.paymentRef, phase3Run.paymentHash);
        } catch { return false; }
      });
      const [beforeJob, afterJob, role, before, after] = await Promise.all([
        jobAt(receipt.blockNumber - 1n), jobAt(receipt.blockNumber), confirmerAt(receipt.blockNumber),
        statsAt(receipt.blockNumber - 1n), statsAt(receipt.blockNumber),
      ]);
      if (events.length !== 1 || !same(tx.from, role) || beforeJob.status !== 0 || beforeJob.paymentRef !== zeroHash ||
          afterJob.status !== 1 || !same(afterJob.paymentRef, phase3Run.paymentHash) || afterJob.resultHash !== zeroHash ||
          afterJob.completedAt !== 0n) throw new Error('Confirmation transition mismatch');
      return { transactionHash: hash, blockNumber: receipt.blockNumber.toString(), receiptStatus: 'success',
        previousRegistryStatus: 'Created', registryStatus: 'Paid', before: statsJson(before), after: statsJson(after),
        countersMatchExpectedDelta: after.paidJobs === before.paidJobs + 1n &&
          after.successfulJobs === before.successfulJobs && after.failedJobs === before.failedJobs };
    },
  };
}

import { createPublicClient, http, isAddress, zeroAddress, type Address, type PublicClient } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { registryAbi } from './registryAbi';

export const FUJI_CHAIN_ID = 43113;
export interface FujiConfig { rpcUrl: string; registryAddress: Address }

export function normalizeAddress(value: string): Address {
  if (!isAddress(value, { strict: false })) throw new Error('Invalid address');
  return value.toLowerCase() as Address;
}

export function loadFujiConfig(env: NodeJS.ProcessEnv = process.env): FujiConfig {
  const rpcUrl = env.AVALANCHE_FUJI_RPC_URL;
  if (!rpcUrl) throw new Error('AVALANCHE_FUJI_RPC_URL is required');
  const url = new URL(rpcUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('RPC URL must use HTTP(S)');
  const registryAddress = normalizeAddress(env.SERVICE_PROOF_REGISTRY_ADDRESS ?? '');
  if (registryAddress === zeroAddress) throw new Error('Registry address must be nonzero');
  return { rpcUrl, registryAddress };
}

export async function assertFuji(client: Pick<PublicClient, 'getChainId'>): Promise<void> {
  if (await client.getChainId() !== FUJI_CHAIN_ID) throw new Error('RPC network must be Avalanche Fuji (43113)');
}

export async function createFujiClient(config: FujiConfig = loadFujiConfig()) {
  const client = createPublicClient({ chain: avalancheFuji, transport: http(config.rpcUrl) });
  await assertFuji(client);
  return client;
}

export function createRegistryReader(client: Pick<PublicClient, 'getChainId' | 'readContract'>, address: Address) {
  const registryAddress = normalizeAddress(address);
  return {
    async getJob(jobId: bigint) {
      await assertFuji(client);
      return client.readContract({ address: registryAddress, abi: registryAbi, functionName: 'getJob', args: [jobId] });
    },
    async getSellerStats(seller: Address) {
      await assertFuji(client);
      const [paidJobs, successfulJobs, failedJobs] = await client.readContract({ address: registryAddress, abi: registryAbi, functionName: 'sellerStats', args: [normalizeAddress(seller)] });
      return { paidJobs, successfulJobs, failedJobs };
    },
    async getPaymentConfirmer() {
      await assertFuji(client);
      return client.readContract({ address: registryAddress, abi: registryAbi, functionName: 'paymentConfirmer' });
    },
    async getValidator() {
      await assertFuji(client);
      return client.readContract({ address: registryAddress, abi: registryAbi, functionName: 'validator' });
    },
  };
}

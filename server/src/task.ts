import { isAddress, keccak256, toHex, zeroAddress, type Address } from 'viem';

// Pure shared task definitions: no runtime configuration, RPC, or signing.
export const FUJI_CHAIN_ID = 43113;
export const DEMO_PAYMENT_WEI = 1_000_000_000_000n; // 0.000001 native AVAX

export function normalizeAddress(value: string): Address {
  if (!isAddress(value, { strict: false })) throw new Error('Invalid address');
  return value.toLowerCase() as Address;
}

export interface WeatherTask {
  serviceType: 'weather'; city: string; sellerId: string; sellerAddress: string;
  maxResponseTimeMs: number; paymentAmountWei: bigint;
}
export function taskAddress(value: string): Address {
  const normalized = normalizeAddress(value);
  if (normalized === zeroAddress) throw new Error('Address must be nonzero');
  return normalized;
}
// Versioned fixed-position tuples avoid object-key ordering and bigint JSON ambiguity.
export function canonicalTask(task: WeatherTask): string {
  if (task.serviceType !== 'weather' || !task.city.trim() || !task.sellerId.trim()) throw new Error('Invalid weather task');
  if (!Number.isFinite(task.maxResponseTimeMs) || task.maxResponseTimeMs <= 0) throw new Error('Invalid SLA threshold');
  if (typeof task.paymentAmountWei !== 'bigint' || task.paymentAmountWei <= 0n) throw new Error('Invalid payment amount');
  return JSON.stringify(['apos.weather.v1', task.serviceType, task.city, task.sellerId,
    taskAddress(task.sellerAddress), task.maxResponseTimeMs, 'native-AVAX', FUJI_CHAIN_ID, task.paymentAmountWei.toString()]);
}
export const hashTask = (task: WeatherTask) => keccak256(toHex(canonicalTask(task)));

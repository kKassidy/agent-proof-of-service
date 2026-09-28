// Read ABI and write preparation ABI matching
// contracts/src/ServiceProofRegistry.sol. Regenerate when the contract changes.
export const registryWriteAbi = [
  { type: 'function', name: 'createJob', stateMutability: 'nonpayable',
    inputs: [{ name: 'seller', type: 'address' }, { name: 'taskHash', type: 'bytes32' }],
    outputs: [{ name: 'jobId', type: 'uint256' }] },
  { type: 'function', name: 'confirmPayment', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'paymentRef', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'recordOutcome', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'outcome', type: 'uint8' }, { name: 'resultHash', type: 'bytes32' }], outputs: [] },
] as const;

export const registryAbi = [
  {
    "type": "function",
    "name": "getJob",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ServiceProofRegistry.Job",
        "components": [
          {
            "name": "buyer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "seller",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "taskHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "paymentRef",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "resultHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "createdAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "completedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum ServiceProofRegistry.Status"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "paymentConfirmer",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sellerStats",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "paidJobs",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "successfulJobs",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "failedJobs",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "validator",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  }
] as const;

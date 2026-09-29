// Historical evidence supplied for the Buildathon demo. Never replaced by live reads.
export const registry = '0x442EacAd079CcE0e3671ee0B2eb75c199f36e917'
export const seller = '0x0342ed8eaC11a52C247C9428c450A7288b72f484'
// Matches the Avalanche Fuji chain definition already installed in server/.
export const explorer = 'https://testnet.snowtrace.io'
export const jobs = [
  {
    id: 1, success: true, latency: '77.597', checks: 6,
    response: '{"city":"Tokyo","temperatureC":22,"condition":"clear"}',
    payment: '0xffba988bcbfb5444db011f18e961974fa740d15a4cad996de013346b90dac92b',
    result: '0x72f7e083b133da6eee43e57323d28103798f147925e28b548e88ff5898961eb5',
    outcome: '0xd0735337b050c18f4b17c0a4361ece666c4e64754af1a9817bbf809a406a1267',
  },
  {
    id: 2, success: false, latency: '62.074', checks: 5,
    response: '{"city":"Tokyo","condition":"clear"}',
    payment: '0x28521fa0c88172f6ee5d59a87efb853b2400495f3c59118c079764a6def38fc9',
    result: '0x9e57fabdbce8dd1a18988c4816a10d47726534ac53477eaf0e0b96b964be4589',
    outcome: '0x473c03856ab58b9b6a874f92eb426dd7f9d0a9b2319c2f445a1c04d329ddf950',
  },
] as const
export const sellers = [
  { id: 'A', name: 'Reliable Weather Agent', price: '$0.01', jobs: 103, success: 99, failures: 4, rate: '96.1%', selected: true, reason: 'Meets all buyer policy requirements' },
  { id: 'B', name: 'Budget Weather Agent', price: '$0.005', jobs: 250, success: 153, failures: 97, rate: '61.2%', selected: false, reason: 'Success rate below minimum' },
  { id: 'C', name: 'Unverified Weather Agent', price: '$0.002', jobs: 0, success: 0, failures: 0, rate: 'No verified rate', selected: false, reason: 'Insufficient verified jobs / no verified history' },
]

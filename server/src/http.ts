import { createServer, type IncomingMessage } from 'node:http';
import { callMockSeller, defaultMaxResponseTimeMs, evaluateSeller, policy, runDemo, sellers } from './service';
import { handlePhase3, phase3Handler } from './phase3Http';
import { handlePhase4, phase4Handler } from './phase4Http';

async function readOptions(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new Error('Request body exceeds 8192 bytes');
    chunks.push(Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString('utf8');
  const options: unknown = body.trim() ? JSON.parse(body) : {};
  if (typeof options !== 'object' || options === null || Array.isArray(options)) throw new Error('Expected a JSON object');
  const { city = 'Sydney', maxResponseTimeMs = defaultMaxResponseTimeMs } = options as Record<string, unknown>;
  if (typeof city !== 'string' || !city.trim()) throw new Error('city must be a non-empty string');
  if (typeof maxResponseTimeMs !== 'number' || !Number.isFinite(maxResponseTimeMs) || maxResponseTimeMs <= 0) throw new Error('maxResponseTimeMs must be a positive finite number');
  return { city, maxResponseTimeMs };
}

export function createApiServer(phase3 = phase3Handler, phase4 = phase4Handler) {
  return createServer(async (request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body));
    };
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (request.method === 'POST') {
      const phase4Route = /^\/api\/phase4\/(execute|prepare|refresh)$/.exec(url.pathname);
      if (phase4Route) return handlePhase4(request, response, phase4Route[1] as 'execute' | 'prepare' | 'refresh', phase4);
      const phase3Route = /^\/api\/phase3\/(verify|prepare|refresh)$/.exec(url.pathname);
      if (phase3Route) return handlePhase3(request, response, phase3Route[1] as 'verify' | 'prepare' | 'refresh', phase3);
    }
    if (request.method === 'GET' && url.pathname === '/api/sellers') return send(200, sellers.map(seller => evaluateSeller(seller)));
    if (request.method === 'GET' && url.pathname === '/api/policy') return send(200, { ...policy, maxResponseTimeMs: defaultMaxResponseTimeMs });
    const match = /^\/api\/sellers\/([^/]+)\/weather$/.exec(url.pathname);
    if (request.method === 'GET' && match) {
      const seller = sellers.find(candidate => candidate.id === match[1]);
      if (!seller) return send(404, { error: 'Seller not found' });
      const city = url.searchParams.get('city') ?? 'Sydney';
      if (!city.trim()) return send(400, { error: 'city must be a non-empty string' });
      const scenario = url.searchParams.get('scenario') ?? url.searchParams.get('mode') ?? 'success';
      if (scenario !== 'success' && scenario !== 'failure') return send(400, { error: 'scenario must be success or failure' });
      const result = callMockSeller(seller, city, scenario);
      response.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
      return response.end(result.body);
    }
    if (request.method === 'POST' && (url.pathname === '/api/demo/success' || url.pathname === '/api/demo/failure')) {
      try {
        const options = await readOptions(request);
        return send(200, runDemo(url.pathname.endsWith('/success') ? 'success' : 'failure', options.city, options.maxResponseTimeMs));
      } catch (error) { return send(400, { error: error instanceof Error ? error.message : 'Invalid request' }); }
    }
    send(404, { error: 'Route not found' });
  });
}

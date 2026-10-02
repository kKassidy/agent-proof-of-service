import type { IncomingMessage, ServerResponse } from 'node:http';
import { inspectPhase3, parsePhase3Input, type Phase3Action } from './phase3';
import { createPhase3Reader } from './phase3Rpc';

export const phase3Handler = (input: unknown, action: Phase3Action) => inspectPhase3(createPhase3Reader(), input, action);
export async function handlePhase3(request: IncomingMessage, response: ServerResponse, action: Phase3Action, handler = phase3Handler) {
  const send = (status: number, body: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  let input;
  try {
    if (!request.headers['content-type']?.startsWith('application/json')) throw new Error();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 1024) throw new Error();
      chunks.push(Buffer.from(chunk));
    }
    input = parsePhase3Input(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch { return send(400, { error: 'Invalid Phase 3 request. Supply only approved job/payment hashes.' }); }
  try { send(200, await handler(input, action)); }
  catch {
    // Never echo raw RPC exceptions, request bodies, URLs or configuration.
    send(503, { error: 'Phase 3 evidence unavailable or registry terms do not match. Refresh; do not submit another transaction.' });
  }
}

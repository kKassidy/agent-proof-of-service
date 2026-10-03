import type { IncomingMessage, ServerResponse } from 'node:http';
import { inspectPhase4, parsePhase4Input } from './phase4';
import { createPhase4Reader } from './phase4Rpc';
import { createPhase4Store } from './phase4Store';
import type { Phase4Action } from './phase4Types';

export const phase4Handler = (input: unknown, action: Phase4Action) => inspectPhase4(createPhase4Reader(), createPhase4Store(), input, action);
export async function handlePhase4(request: IncomingMessage, response: ServerResponse, action: Phase4Action, handler = phase4Handler) {
  const send = (status: number, body: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  let input;
  try {
    if (!request.headers['content-type']?.startsWith('application/json')) throw new Error();
    // Execution is an explicit same-origin POST, never a page-load GET.
    if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) throw new Error();
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length; if (size > 1024) throw new Error();
      chunks.push(Buffer.from(chunk));
    }
    input = parsePhase4Input(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch { return send(400, { error: 'Invalid Phase 4 request. Supply only Job #3 and an optional public outcome hash from the same origin.' }); }
  try { send(200, await handler(input, action)); }
  catch { send(503, { error: 'Phase 4 evidence unavailable, execution uncertain, or registry mismatch. Refresh only; do not delete frozen evidence, rerun service, or resend a transaction.' }); }
}

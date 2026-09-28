import { createApiServer } from './http';

const server = createApiServer();
server.listen(3001, '127.0.0.1', () => {
  console.log('Agent Proof-of-Service mock API: http://127.0.0.1:3001');
});

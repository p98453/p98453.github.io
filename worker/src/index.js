import { connect } from 'cloudflare:sockets';
import { handle } from './handle.js';

export default {
  async fetch(request, env) {
    return handle(request, env, fetch, { connect });
  },
};

// A client for the Crosspeel MCP server.
//
// Nothing here is required to use Crosspeel. An agent harness configured with
// the endpoint calls the tools directly, which is the whole install path. This
// client exists for code that wants to call the tools outside a harness, and
// for anyone who wants to check the responses against the published rules
// before acting on them.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { SERVER, TOOL_NAMES } from './contract.js';
import { assertVerified, verifyResponse } from './verify.js';

export const DEFAULT_ENDPOINT = 'https://mcp.crosspeel.com';

/**
 * Connect to a Crosspeel MCP server.
 *
 * @param {{ endpoint?: string,
 *           name?: string,
 *           version?: string,
 *           verify?: boolean,
 *           fetch?: typeof fetch }} [options]
 *   verify defaults to true: every response is checked against the four
 *   published rules and the call raises where one is broken. Set it to false to
 *   receive the response unchecked and run verifyResponse yourself.
 */
export async function connect(options = {}) {
  const endpoint = options.endpoint || DEFAULT_ENDPOINT;
  const verify = options.verify !== false;

  const client = new Client(
    { name: options.name || 'crosspeel-client', version: options.version || '0.1.0' },
    { capabilities: {} }
  );
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    fetch: options.fetch,
  });
  await client.connect(transport);

  async function call(name, args) {
    if (!TOOL_NAMES.includes(name)) {
      throw new Error(`no tool named ${name} is published. The tools are ${TOOL_NAMES.join(', ')}.`);
    }
    const response = await client.callTool({ name, arguments: args });
    if (response.isError) {
      const text = (response.content || []).map((c) => c.text).filter(Boolean).join(' ');
      throw new Error(text || 'the call was refused and no reason was returned');
    }
    const payload = response.structuredContent || parseTextContent(response);
    return verify ? assertVerified(payload) : payload;
  }

  return {
    server: SERVER,
    endpoint,

    /** @param {string[]} endpoints @param {'cached'|'live'} [depth] */
    checkStack(endpoints, depth = 'cached') {
      return call('check_stack', { endpoints, depth });
    },

    /** @param {string} endpoint */
    getCluster(endpoint) {
      return call('get_cluster', { endpoint });
    },

    /** @param {string} endpoint */
    cheapestEquivalent(endpoint) {
      return call('cheapest_equivalent', { endpoint });
    },

    listTools() {
      return client.listTools();
    },

    verifyResponse,

    async close() {
      await client.close();
    },
  };
}

function parseTextContent(response) {
  const block = (response.content || []).find((c) => c.type === 'text');
  if (!block) throw new Error('the response carried no readable content');
  return JSON.parse(block.text);
}

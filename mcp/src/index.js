// Crosspeel MCP - published contract, response format, and client.

export {
  CONTRACT_VERSION,
  LIMITS,
  METHOD_VERSION,
  OUTPUT_SCHEMAS,
  PAYMENT,
  PROTOCOL_VERSIONS,
  SERVER,
  TOOLS,
  TOOL_NAMES,
  toolDefinition,
} from './contract.js';

export { assertVerified, verifyResponse } from './verify.js';
export { DEFAULT_ENDPOINT, connect } from './client.js';

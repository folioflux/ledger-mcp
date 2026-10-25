// Preloaded with `node --import` in the stdio test. Replaces every way Node can
// open a network connection or resolve a host name with a function that reports
// the attempt on stderr and throws, so the test can assert that none happened.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

const MARKER = 'LEDGER_MCP_NETWORK_ATTEMPT';

function block(name) {
  return function blocked() {
    process.stderr.write(`${MARKER} ${name}\n`);
    throw new Error(`Network access is blocked in this test (${name}).`);
  };
}

net.connect = block('net.connect');
net.createConnection = block('net.createConnection');
net.Socket.prototype.connect = block('net.Socket.connect');
tls.connect = block('tls.connect');
http.request = block('http.request');
http.get = block('http.get');
https.request = block('https.request');
https.get = block('https.get');
dns.lookup = block('dns.lookup');
dns.resolve = block('dns.resolve');
dns.promises.lookup = block('dns.promises.lookup');
dns.promises.resolve = block('dns.promises.resolve');
globalThis.fetch = block('fetch');
globalThis.WebSocket = block('WebSocket');
syncBuiltinESMExports();

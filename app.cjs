'use strict';
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
console.info('[aharon-crm-node] HOSTINGER_CJS_BOOTSTRAP_LOADED');
const entrypoint = pathToFileURL(join(__dirname, 'src', 'server.js')).href;
void import(entrypoint).then(({start})=>start()).catch((error) => {
  console.error('[aharon-crm-node] Node core failed to start:', error);
  process.exit(1);
});

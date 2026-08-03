#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './register.js';

const server = new McpServer(
  {
    name: 'openapps-by-mbza',
    version: '2.0.0',
  },
  {
    instructions:
      'OpenApps by MBZA — App Store & Google Play intelligence toolkit. ' +
      'Search apps, track competitors, monitor store listing changes, ' +
      'analyze user reviews, explore trending charts, and discover publishers. ' +
      'The server exposes 29 tools: 25 read and 4 write tools.',
  },
);

registerAllTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);

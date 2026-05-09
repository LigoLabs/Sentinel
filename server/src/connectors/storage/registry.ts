import type { StorageConnector } from './types.js';
import { VercelBlobConnector } from './vercel-blob.js';
import { SshSftpConnector } from './ssh-sftp.js';

const connectors = new Map<string, StorageConnector>();

function register(connector: StorageConnector): void {
  connectors.set(connector.type, connector);
}

export function getStorageConnector(type: string): StorageConnector {
  const connector = connectors.get(type);
  if (!connector) {
    throw new Error(`Unknown storage connector type: ${type}. Available: ${[...connectors.keys()].join(', ')}`);
  }
  return connector;
}

export function getStorageConnectorTypes(): string[] {
  return [...connectors.keys()];
}

register(new VercelBlobConnector());
register(new SshSftpConnector());

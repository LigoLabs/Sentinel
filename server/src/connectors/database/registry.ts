import type { DatabaseConnector } from './types.js';
import { TursoConnector } from './turso.js';
import { MysqlSshConnector } from './mysql-ssh.js';
import { PostgresSshConnector } from './postgres-ssh.js';
import { WordPressConnector } from './wordpress.js';

const connectors = new Map<string, DatabaseConnector>();

function register(connector: DatabaseConnector): void {
  connectors.set(connector.type, connector);
}

export function getDatabaseConnector(type: string): DatabaseConnector {
  const connector = connectors.get(type);
  if (!connector) {
    throw new Error(`Unknown database connector type: ${type}. Available: ${[...connectors.keys()].join(', ')}`);
  }
  return connector;
}

export function getDatabaseConnectorTypes(): string[] {
  return [...connectors.keys()];
}

register(new TursoConnector());
register(new MysqlSshConnector());
register(new PostgresSshConnector());
register(new WordPressConnector());

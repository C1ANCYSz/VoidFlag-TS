import { FlagMap } from './FlagMap.js';

interface BaseClientOptions<S extends FlagMap> {
  schema: S;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (err: Error, attempt: number) => void;
  onFallback?: () => void;
}
interface DevOptions<S extends FlagMap> extends BaseClientOptions<S> {
  dev: true;
  envKey?: never;
}

interface ProdOptions<S extends FlagMap> extends BaseClientOptions<S> {
  envKey: string;
  dev?: never;
}

export type ClientOptions<S extends FlagMap> = DevOptions<S> | ProdOptions<S>;

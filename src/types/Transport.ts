export interface Transport {
  start(): void | Promise<void>;
  stop(): void;
}

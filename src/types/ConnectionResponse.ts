interface PollingConnectResponse {
  transport: 'polling';
  pollInterval?: number;
}

interface SSEConnectResponse {
  transport: 'sse';
  streamUrl: string;
}

export type ConnectResponse = PollingConnectResponse | SSEConnectResponse;

import { useEffect, useState } from "react";

const requestTimestamps: number[] = [];
let lastDbWriteAt: number | null = null;
let lastDbLoadAt: number | null = null;
let lastEdgeCallAt: number | null = null;
let lastEdgeResponseAt: number | null = null;

const trimOld = (now: number) => {
  const cutoff = now - 60_000;
  while (requestTimestamps.length > 0 && requestTimestamps[0] < cutoff) {
    requestTimestamps.shift();
  }
};

export const recordNetworkRequest = () => {
  const now = Date.now();
  requestTimestamps.push(now);
  trimOld(now);
};

export const recordDbWrite = () => {
  lastDbWriteAt = Date.now();
  recordNetworkRequest();
};

export const recordDbLoad = () => {
  lastDbLoadAt = Date.now();
  recordNetworkRequest();
};

export const recordEdgeCall = () => {
  lastEdgeCallAt = Date.now();
  recordNetworkRequest();
};

export const recordEdgeResponse = () => {
  lastEdgeResponseAt = Date.now();
};

export const getNetworkSnapshot = () => {
  const now = Date.now();
  trimOld(now);
  return {
    requestsPerMinute: requestTimestamps.length,
    lastRequestAt: requestTimestamps.length > 0 ? requestTimestamps[requestTimestamps.length - 1] : null,
    lastDbWriteAt,
    lastDbLoadAt,
    lastEdgeCallAt,
    lastEdgeResponseAt,
  };
};

export function useNetworkHealth(pollMs = 1000) {
  const [snapshot, setSnapshot] = useState(getNetworkSnapshot());

  useEffect(() => {
    const interval = setInterval(() => {
      setSnapshot(getNetworkSnapshot());
    }, pollMs);
    return () => clearInterval(interval);
  }, [pollMs]);

  return snapshot;
}

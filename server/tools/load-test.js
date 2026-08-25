'use strict';

const http = require('http');
const https = require('https');
const { performance } = require('perf_hooks');

const targetUrl = new URL(process.env.TARGET_URL || 'http://127.0.0.1:8080/api/health');
const targetRps = Math.max(1, Number(process.env.TARGET_RPS || 2000));
const durationSeconds = Math.max(1, Number(process.env.DURATION_SECONDS || 10));
const tickMilliseconds = 100;
const requestsPerTick = Math.max(1, Math.round(targetRps * tickMilliseconds / 1000));
const transport = targetUrl.protocol === 'https:' ? https : http;
const agent = new transport.Agent({ keepAlive: true, maxSockets: 1024, maxFreeSockets: 256 });
const latencies = [];
const statuses = new Map();
let started = 0;
let completed = 0;
let failed = 0;
let inFlight = 0;
let schedulingFinished = false;
const startedAt = performance.now();

function requestOnce() {
  started += 1;
  inFlight += 1;
  const requestStartedAt = performance.now();
  const request = transport.request(targetUrl, {
    method: 'GET',
    agent,
    headers: process.env.AUTH_TOKEN ? { Authorization: `Bearer ${process.env.AUTH_TOKEN}` } : {},
  }, (response) => {
    response.resume();
    response.on('end', () => {
      completed += 1;
      inFlight -= 1;
      statuses.set(response.statusCode, (statuses.get(response.statusCode) || 0) + 1);
      latencies.push(performance.now() - requestStartedAt);
    });
  });
  request.on('error', () => {
    failed += 1;
    inFlight -= 1;
    latencies.push(performance.now() - requestStartedAt);
  });
  request.end();
}

const ticker = setInterval(() => {
  if (performance.now() - startedAt >= durationSeconds * 1000) {
    schedulingFinished = true;
    clearInterval(ticker);
    return;
  }
  for (let index = 0; index < requestsPerTick; index += 1) requestOnce();
}, tickMilliseconds);

const reporter = setInterval(() => {
  if (schedulingFinished && inFlight === 0) {
    clearInterval(reporter);
    agent.destroy();
    latencies.sort((a, b) => a - b);
    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    const percentile = (value) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * value))] || 0;
    const result = {
      url: targetUrl.toString(), target_rps: targetRps, duration_seconds: durationSeconds,
      requests_started: started, requests_completed: completed, requests_failed: failed,
      achieved_rps: Number((completed / elapsedSeconds).toFixed(1)),
      latency_ms: { p50: Number(percentile(0.5).toFixed(1)), p95: Number(percentile(0.95).toFixed(1)), p99: Number(percentile(0.99).toFixed(1)) },
      statuses: Object.fromEntries(statuses),
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(failed || [...statuses.keys()].some((status) => status >= 500) ? 1 : 0);
  }
}, 50);

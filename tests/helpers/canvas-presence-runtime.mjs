import assert from "node:assert/strict";
import { CanvasPresenceHub as ProductionHub } from "../../src/canvas/presence.ts";

// Deterministic, in-memory ports for the actual local-tab hub. No real browser,
// storage, timers, network or account authority is supplied by this fixture.
export function createPresenceBrowser(defaultScope) {
  let now = 1_900_000_000_000, serial = 0;
  const tabs = new Map(), channels = [], timers = new Map(), deliveries = [];
  function runtime(tabId) {
    if (!tabs.has(tabId)) tabs.set(tabId, { id: tabId, connections: 0 });
    return {
      tab: tabs.get(tabId), now: () => now, connectionId: () => "connection-" + ++serial,
      channel(name) {
        const channel = { name, closed: false, onmessage: null, posts: [],
          postMessage(data) {
            assert.equal(this.closed, false);
            const value = structuredClone(data);
            this.posts.push(value);
            for (const target of channels) if (target !== this && !target.closed && target.name === name)
              deliveries.push({ callback: target.onmessage, data: structuredClone(value) });
          },
          close() { this.closed = true; },
        };
        channels.push(channel);
        return channel;
      },
      setInterval(callback) { const id = ++serial; timers.set(id, callback); return id; },
      clearInterval(id) { timers.delete(id); },
    };
  }
  function flush() { while (deliveries.length) { const next = deliveries.shift(); next.callback?.({ data: next.data }); } }
  function advance(milliseconds, tick = true) {
    now += milliseconds;
    if (tick) for (const callback of [...timers.values()]) callback();
    flush();
  }
  function hub(tabId, wanted = defaultScope, current = () => true) {
    const instance = new ProductionHub(runtime(tabId)), snapshots = [];
    instance.subscribe(value => snapshots.push(value));
    assert.equal(instance.connect(wanted, current), true);
    return { hub: instance, channel: channels.at(-1), peers: () => snapshots.at(-1), snapshots };
  }
  return { runtime, hub, channels, timers, deliveries, flush, advance, now: () => now,
    inject: (channel, data) => channel.onmessage?.({ data: structuredClone(data) }) };
}

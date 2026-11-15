export class ComputeClient {
  constructor() {
    this.worker = new Worker(new URL('./route-worker.js', import.meta.url), { type: 'module' });
    this.pending = new Map();
    this.nextId = 0;
    this.queue = [];
    this.active = null;
    this.worker.onmessage = ({ data }) => {
      const entry = this.pending.get(data.id);
      if (!entry) return;
      this.pending.delete(data.id);
      this.active = null;
      if (data.error) entry.reject(new Error(data.error));
      else entry.resolve(data.result);
      this.dispatch();
    };
    this.worker.onerror = (event) => {
      this.failure = new Error(event.message || '계산 작업을 시작하지 못했습니다.');
      for (const entry of this.pending.values()) entry.reject(this.failure);
      this.pending.clear();
      this.queue = [];
      this.active = null;
    };
  }
  request(type, payload) {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      // Keep the newest queued input; an active calculation finishes in isolation.
      this.queue = this.queue.filter(job => {
        const superseded = job.type === type || (type === 'region' && job.type !== 'init' && job.type !== 'world-density') || (type === 'density' && job.type === 'compute');
        if (superseded) {
          this.pending.get(job.id).reject(new Error('STALE'));
          this.pending.delete(job.id);
        }
        return !superseded;
      });
      this.pending.set(id, { resolve, reject });
      this.queue.push({ id, type, payload });
      this.dispatch();
    });
  }
  dispatch() {
    if (this.active || !this.queue.length) return;
    this.active = this.queue.shift();
    this.worker.postMessage(this.active);
  }
}

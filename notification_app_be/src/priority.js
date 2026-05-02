const TYPE_WEIGHTS = {
  Placement: 3,
  Result: 2,
  Event: 1,
};

function toEpochMillis(value) {
  if (typeof value !== "string") {
    return 0;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }
  const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const withZulu = normalized.endsWith("Z") ? normalized : `${normalized}Z`;
  const parsed = Date.parse(withZulu);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }
  const fallback = Date.parse(normalized);
  return Number.isNaN(fallback) ? 0 : fallback;
}

function scoreItem(notification) {
  const type = notification && typeof notification.Type === "string"
    ? notification.Type.trim()
    : "";
  const weight = TYPE_WEIGHTS[type] || 0;
  const timestamp = toEpochMillis(notification && notification.Timestamp);
  return weight * 1000000000000 + timestamp;
}

class MinScoreHeap {
  constructor() {
    this.nodes = [];
  }

  size() {
    return this.nodes.length;
  }

  peek() {
    return this.nodes[0];
  }

  push(entry) {
    this.nodes.push(entry);
    this.bubbleUp(this.nodes.length - 1);
  }

  pop() {
    if (this.nodes.length === 0) {
      return null;
    }
    const root = this.nodes[0];
    const last = this.nodes.pop();
    if (this.nodes.length > 0 && last) {
      this.nodes[0] = last;
      this.bubbleDown(0);
    }
    return root;
  }

  bubbleUp(index) {
    let idx = index;
    while (idx > 0) {
      const parentIdx = Math.floor((idx - 1) / 2);
      if (this.nodes[parentIdx].score <= this.nodes[idx].score) {
        break;
      }
      [this.nodes[parentIdx], this.nodes[idx]] = [
        this.nodes[idx],
        this.nodes[parentIdx],
      ];
      idx = parentIdx;
    }
  }

  bubbleDown(index) {
    let idx = index;
    const length = this.nodes.length;
    while (true) {
      const leftIdx = idx * 2 + 1;
      const rightIdx = idx * 2 + 2;
      let smallest = idx;

      if (leftIdx < length && this.nodes[leftIdx].score < this.nodes[smallest].score) {
        smallest = leftIdx;
      }
      if (rightIdx < length && this.nodes[rightIdx].score < this.nodes[smallest].score) {
        smallest = rightIdx;
      }
      if (smallest === idx) {
        break;
      }
      [this.nodes[smallest], this.nodes[idx]] = [
        this.nodes[idx],
        this.nodes[smallest],
      ];
      idx = smallest;
    }
  }
}

function pickTopNotifications(notifications, limit) {
  const target = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 10;
  const heap = new MinScoreHeap();

  for (const notification of notifications) {
    const score = scoreItem(notification);
    const entry = { notification, score };
    if (heap.size() < target) {
      heap.push(entry);
      continue;
    }
    const smallest = heap.peek();
    if (smallest && score > smallest.score) {
      heap.pop();
      heap.push(entry);
    }
  }

  const results = [];
  while (heap.size() > 0) {
    const entry = heap.pop();
    if (entry) {
      results.push(entry);
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.map((entry) => entry.notification);
}

module.exports = { pickTopNotifications, scoreItem };

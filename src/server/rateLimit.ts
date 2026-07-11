type Bucket = { count: number; resetAt: number };

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private operations = 0;

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    this.operations += 1;
    if (this.operations % 100 === 0 || this.buckets.size > 10_000) {
      this.prune(now);
    }
    const bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (bucket.count >= this.maxAttempts) {
      return false;
    }

    bucket.count += 1;
    return true;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) {
        this.buckets.delete(key);
      }
    }

    if (this.buckets.size <= 10_000) return;
    const overflow = this.buckets.size - 10_000;
    for (const key of Array.from(this.buckets.keys()).slice(0, overflow)) {
      this.buckets.delete(key);
    }
  }
}

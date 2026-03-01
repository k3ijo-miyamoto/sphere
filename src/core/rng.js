export class Rng {
  constructor(seed = 123456789) {
    this.state = seed >>> 0;
  }

  next() {
    this.state ^= this.state << 13;
    this.state ^= this.state >>> 17;
    this.state ^= this.state << 5;
    return (this.state >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }
}

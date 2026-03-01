const DAY_PHASES = [
  { name: "Morning", startMinute: 6 * 60, endMinute: 10 * 60 },
  { name: "Daytime", startMinute: 10 * 60, endMinute: 18 * 60 },
  { name: "Evening", startMinute: 18 * 60, endMinute: 22 * 60 },
  { name: "Night", startMinute: 22 * 60, endMinute: 24 * 60 },
  { name: "Night", startMinute: 0, endMinute: 6 * 60 }
];

export class SimClock {
  constructor(dayMinutes = 24 * 60) {
    this.dayMinutes = dayMinutes;
    this.minuteOfDay = 0;
    this.day = 0;
  }

  tick(deltaMinutes) {
    this.minuteOfDay += deltaMinutes;

    while (this.minuteOfDay >= this.dayMinutes) {
      this.minuteOfDay -= this.dayMinutes;
      this.day += 1;
    }
  }

  getPhase() {
    const minute = this.minuteOfDay;
    const found = DAY_PHASES.find((phase) => minute >= phase.startMinute && minute < phase.endMinute);
    return found ? found.name : "Daytime";
  }

  format() {
    const hh = Math.floor(this.minuteOfDay / 60)
      .toString()
      .padStart(2, "0");
    const mm = Math.floor(this.minuteOfDay % 60)
      .toString()
      .padStart(2, "0");
    return `Day ${this.day} ${hh}:${mm}`;
  }
}

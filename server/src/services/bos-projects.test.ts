import { describe, it, expect } from "vitest";
import { projectProgress, billableAmount } from "./bos-projects.js";

describe("projects", () => {
  describe("projectProgress", () => {
    it("returns 0 for an empty task list", () => {
      expect(projectProgress([])).toBe(0);
    });

    it("returns the percentage of done tasks", () => {
      // Arrange
      const tasks = [
        { status: "done" },
        { status: "done" },
        { status: "todo" },
        { status: "in_progress" },
      ];

      // Act
      const progress = projectProgress(tasks);

      // Assert
      expect(progress).toBe(50);
    });

    it("returns 100 when all tasks are done", () => {
      expect(projectProgress([{ status: "done" }, { status: "done" }])).toBe(100);
    });

    it("rounds to the nearest whole percent", () => {
      // 1 of 3 done = 33.33% -> 33
      expect(projectProgress([{ status: "done" }, { status: "todo" }, { status: "todo" }])).toBe(33);
    });
  });

  describe("billableAmount", () => {
    it("returns 0 with no timesheets", () => {
      expect(billableAmount([])).toBe(0);
    });

    it("sums hours * rate for billable entries only", () => {
      // Arrange
      const timesheets = [
        { billable: true, hours: 2, rateMinor: 5000 }, // 10000
        { billable: true, hours: 3, rateMinor: 1000 }, // 3000
        { billable: false, hours: 10, rateMinor: 9999 }, // ignored
      ];

      // Act
      const total = billableAmount(timesheets);

      // Assert
      expect(total).toBe(13000);
    });

    it("treats missing hours/rate as zero", () => {
      expect(billableAmount([{ billable: true }])).toBe(0);
    });
  });
});

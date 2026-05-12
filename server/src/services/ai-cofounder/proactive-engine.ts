// ---------------------------------------------------------------------------
// AI Co-Founder proactive scheduler
// ---------------------------------------------------------------------------
//
// Every N minutes, scan every registered owner-phone across all companies
// and decide whether to push a daily brief (~9am Kuwait time) or weekly
// report (Monday). Best-effort — if a push fails it is retried on the next
// tick. We .unref() the timer so this never holds the process open.
//

import {
  isSameKuwaitDay,
  kuwaitHourMinuteNow,
  type AiCofounderService,
} from "./index.js";

const TICK_INTERVAL_MS = 5 * 60 * 1000;

export interface ProactiveSchedulerHandle {
  stop: () => void;
  /** Test/debug seam — run one tick manually. */
  tick: () => Promise<void>;
}

export function startProactiveScheduler(
  service: AiCofounderService,
  opts: { intervalMs?: number; now?: () => Date } = {},
): ProactiveSchedulerHandle {
  const intervalMs = opts.intervalMs ?? TICK_INTERVAL_MS;
  const now = opts.now ?? (() => new Date());

  let stopped = false;

  async function tick(): Promise<void> {
    if (stopped) return;
    const currentNow = now();
    const k = kuwaitHourMinuteNow(currentNow);
    let owners: Awaited<ReturnType<AiCofounderService["listAllOwnerPhones"]>>;
    try {
      owners = await service.listAllOwnerPhones();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[cofounder] failed to list owner phones", err);
      return;
    }
    for (const owner of owners) {
      const [hStr, mStr] = (owner.briefTime || "09:00").split(":");
      const targetHour = Number(hStr);
      const targetMinute = Number(mStr);
      if (!Number.isFinite(targetHour)) continue;
      // Match the briefTime hour (any minute in that hour counts).
      const hourMatches = k.hour === targetHour;
      if (!hourMatches) continue;
      // Daily brief
      if (
        owner.dailyBriefEnabled &&
        !isSameKuwaitDay(owner.lastDailyBriefSentAt, currentNow)
      ) {
        try {
          await service.sendDailyBrief(owner.companyId, owner.userPhone);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[cofounder] daily brief failed", err);
        }
      }
      // Weekly report — Monday (Kuwait weekday 1)
      if (
        owner.weeklyReportEnabled &&
        k.weekday === 1 &&
        !isSameKuwaitDay(owner.lastWeeklyReportSentAt, currentNow) &&
        Math.abs(k.minute - targetMinute) < 10
      ) {
        try {
          await service.sendWeeklyReport(owner.companyId, owner.userPhone);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[cofounder] weekly report failed", err);
        }
      }
    }
  }

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    tick,
  };
}

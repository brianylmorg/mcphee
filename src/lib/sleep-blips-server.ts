import type { Transaction } from "@libsql/client";

/** Close stranded blips using their completed sleep, or their own start if orphaned.
 * The clock is supplied by the caller; closure stays anchored to recorded sleep times.
 */
export async function reconcileOpenBlips(tx: Transaction, babyId: string, _now: number): Promise<void> {
  await tx.execute({
    sql: `UPDATE activities AS blip
          SET ended_at = MAX(blip.started_at, COALESCE((
                SELECT sleep.ended_at FROM activities AS sleep
                WHERE sleep.baby_id = blip.baby_id AND sleep.type = 'sleep'
                  AND sleep.ended_at IS NOT NULL
                  AND sleep.started_at <= blip.started_at AND sleep.ended_at >= blip.started_at
                ORDER BY sleep.started_at DESC LIMIT 1
              ), blip.started_at)),
              details = json_set(COALESCE(blip.details, '{}'), '$.ending', 'woke')
          WHERE blip.baby_id = ? AND blip.type = 'sleepblip' AND blip.ended_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM activities AS open_sleep
              WHERE open_sleep.baby_id = blip.baby_id AND open_sleep.type = 'sleep'
                AND open_sleep.ended_at IS NULL
                AND open_sleep.started_at = (
                  SELECT MAX(started_at) FROM activities
                  WHERE baby_id = ? AND type = 'sleep' AND ended_at IS NULL
                )
                AND open_sleep.started_at <= blip.started_at
            )`,
    args: [babyId, babyId],
  });
}

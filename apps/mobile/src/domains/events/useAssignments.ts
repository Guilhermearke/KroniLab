/** Escala do culto: quem foi chamado e quem confirmou. */
import { useCallback, useEffect, useState } from 'react';
import type { AssignmentStatus, Instrument } from '@kronilab/core';
import { getDb } from '../../data/db.ts';

export interface AssignmentRow {
  id: string;
  instrument: Instrument;
  memberId: string;
  memberName: string;
  status: AssignmentStatus;
}

export function useAssignments(eventId: string) {
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);

  const load = useCallback(async () => {
    const conn = await getDb();
    const rows = await conn.getAllAsync<any>(
      'select * from event_members where event_id = ? order by instrument', [eventId],
    );
    setAssignments(rows.map((r) => ({
      id: r.id, instrument: r.instrument, memberId: r.member_id,
      memberName: r.member_name, status: r.status,
    })));
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  const respond = useCallback(async (assignmentId: string, status: AssignmentStatus) => {
    const conn = await getDb();
    await conn.runAsync(
      'update event_members set status = ?, responded_at = ? where id = ?',
      [status, new Date().toISOString(), assignmentId],
    );
    await load();
  }, [load]);

  const confirmed = assignments.filter((a) => a.status === 'confirmed').length;
  return { assignments, confirmed, total: assignments.length, respond, reload: load };
}

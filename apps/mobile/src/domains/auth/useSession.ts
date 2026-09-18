/** Sessao do membro logado: quem e, em que igreja, com que papel. */
import { useEffect, useState } from 'react';
import { can } from '@kronilab/core';
import type { Action, Member, Role } from '@kronilab/core';
import { supabase, isCloudConfigured } from '../../data/supabase.ts';

export interface SessionApi {
  member: Member | null;
  churchId: string;
  role: Role;
  loading: boolean;
  allows(action: Action): boolean;
}

export function useSession(): SessionApi {
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!isCloudConfigured()) { setLoading(false); return; }
      const { data } = await supabase.auth.getUser();
      if (!data.user) { setLoading(false); return; }
      const { data: row } = await supabase
        .from('church_members').select('*').eq('user_id', data.user.id).single();
      if (row) {
        setMember({
          id: row.id, churchId: row.church_id, userId: row.user_id, name: row.name,
          role: row.role, instrument: row.instrument, instruments: row.instruments ?? [],
          avatarUrl: row.avatar_url, pushToken: row.push_token,
        });
      }
      setLoading(false);
    })();
  }, []);

  const role: Role = member?.role ?? 'MEMBER';
  return { member, churchId: member?.churchId ?? '', role, loading, allows: (a) => can(role, a) };
}

/** Permissoes por papel (item 2). */
import { ROLE_RANK } from './types.ts';
import type { Role } from './types.ts';

export type Action =
  | 'church:manage'
  | 'ministry:manage'
  | 'event:create'
  | 'event:publish'
  | 'schedule:assign'
  | 'setlist:edit'
  | 'song:upload'
  | 'song:edit-analysis'
  | 'key:set'
  | 'live:operate'
  | 'assignment:respond'
  | 'song:study';

const MIN_ROLE: Record<Action, Role> = {
  'church:manage': 'ADMIN',
  'ministry:manage': 'MINISTRY_LEADER',
  'event:create': 'MINISTRY_LEADER',
  'event:publish': 'MINISTRY_LEADER',
  'schedule:assign': 'MINISTRY_LEADER',
  'setlist:edit': 'WORSHIP_LEADER',
  'song:upload': 'WORSHIP_LEADER',
  'song:edit-analysis': 'WORSHIP_LEADER',
  // Quem define o tom do culto e o ministro. Ninguem abaixo disso.
  'key:set': 'WORSHIP_LEADER',
  'live:operate': 'MEMBER',
  'assignment:respond': 'MEMBER',
  'song:study': 'MEMBER',
};

export function can(role: Role, action: Action): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[MIN_ROLE[action]];
}

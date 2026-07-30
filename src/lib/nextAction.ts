// Formatação visual do prazo de uma "próxima ação" (crm_activities com due_at).
// Compartilhado entre o componente NextActions e o badge do card no funil.

export type DueTone = 'overdue' | 'today' | 'future';

export interface DueBadge {
  tone: DueTone;
  // Rótulo curto para o badge do card ("Atrasada" / "Hoje" / "21/07").
  short: string;
  // Rótulo completo para o destaque na seção ("Atrasada · 20/07 14:00").
  full: string;
  // Cores (texto/fundo) no padrão dark glassmorphism.
  className: string;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function dueBadge(dueAt: string): DueBadge {
  const due = new Date(dueAt);
  const now = new Date();

  const time = due.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dayMonth = due.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const dateTime = `${dayMonth} ${time}`;

  if (due.getTime() < now.getTime()) {
    return {
      tone: 'overdue',
      short: 'Atrasada',
      full: `Atrasada · ${dateTime}`,
      className: 'bg-[rgba(239,68,68,0.14)] text-[#EF4444]',
    };
  }
  if (sameDay(due, now)) {
    return {
      tone: 'today',
      short: `Hoje ${time}`,
      full: `Hoje · ${time}`,
      className: 'bg-[rgba(245,158,11,0.14)] text-[#FBBF24]',
    };
  }
  return {
    tone: 'future',
    short: dayMonth,
    full: dateTime,
    className: 'bg-[rgba(96,165,250,0.14)] text-[#60A5FA]',
  };
}

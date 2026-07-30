// ============================================================================
// delete-team-member
// ----------------------------------------------------------------------------
// Admin remove um membro da equipe. Apaga o usuário do Supabase Auth
// (auth.users) — o registro em whatsapp_hub.app_users cai junto (FK) e, por
// segurança, é removido explicitamente também.
//
// Só `admin` pode remover. Um admin não pode remover a si mesmo (evita a
// instância ficar sem owner por acidente).
// ============================================================================

import { requireAdmin, AuthError } from '../_shared/auth.ts';
import { getAdminClient, getAuthAdminClient } from '../_shared/supabase-admin.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    const caller = await requireAdmin(req);

    let body: { user_id?: string };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ ok: false, error: 'JSON inválido.' }, { status: 400 });
    }

    const userId = (body.user_id ?? '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
      return jsonResponse({ ok: false, error: 'user_id inválido.' }, { status: 400 });
    }
    if (userId === caller.userId) {
      return jsonResponse({ ok: false, error: 'Você não pode remover a si mesmo.' }, { status: 400 });
    }

    const db = getAdminClient();

    // 1) Verifica se o usuário existe na tabela de membros
    const { data: member, error: findErr } = await db
      .from('app_users')
      .select('user_id, role') // role será usado se ativar a verificação de último admin
      .eq('user_id', userId)
      .maybeSingle();

    if (findErr || !member) {
      return jsonResponse({ ok: false, error: 'Usuário não encontrado na equipe.' }, { status: 404 });
    }

    // (Opcional) Impede a remoção do último administrador
    // Descomente as linhas abaixo se quiser garantir que sempre haja pelo menos um admin
    /*
    if (member.role === 'admin') {
      const { count, error: countErr } = await db
        .from('app_users')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'admin');

      if (countErr) {
        console.error('Erro ao contar administradores:', countErr);
        return jsonResponse({ ok: false, error: 'Erro interno ao verificar administradores.' }, { status: 500 });
      }

      if (count === 1) {
        return jsonResponse(
          { ok: false, error: 'Não é possível remover o único administrador.' },
          { status: 400 }
        );
      }
    }
    */

    // 2) Remove o usuário do Auth (primeiro, para evitar inconsistência)
    const authAdmin = getAuthAdminClient();
    const { error: authError } = await authAdmin.auth.admin.deleteUser(userId);
    if (authError) {
      return jsonResponse({ ok: false, error: authError.message }, { status: authError.status ?? 400 });
    }

    // 3) Remove o registro de membro (agora com segurança, pois o auth já foi deletado)
    await db.from('app_users').delete().eq('user_id', userId);

    return jsonResponse({ ok: true, user_id: userId });
  } catch (err) {
    if (err instanceof AuthError) {
      return jsonResponse({ ok: false, error: err.message }, { status: err.status });
    }
    console.error('delete-team-member error', err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : 'Erro interno' },
      { status: 500 },
    );
  }
});
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { loadZernioContext, zfetch, createInboxConversation } from '../_shared/zernio.ts';
import { jsonResponse } from '../_shared/cors.ts';

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  try {
    const ctx = await loadZernioContext();
    if (!ctx) return jsonResponse({ error: 'Zernio nao configurado' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey).schema('whatsapp_hub');

    // 1. Fetch conversations from Zernio
    const q = new URLSearchParams({ accountId: ctx.accountId, sortOrder: "desc", limit: "100" });
    const page: any = await zfetch(ctx.apiKey, `/inbox/conversations?${q.toString()}`);
    const conversations = Array.isArray(page?.data) ? page.data : [];

    // 2. Insert into Supabase
    let synced = 0;
    for (const conv of conversations) {
      if (!conv.participantId) continue;
      
      // Use _shared/zernio.ts createInboxConversation which calls Zernio API again 
      // wait, we just want to create it locally in MegaCRM db. 
      // Let's do it directly.
      const phone = conv.participantId;
      const name = conv.participantName || phone;

      // Upsert contact
      const { data: contact } = await supabase
        .from('contacts')
        .upsert(
          { phone, name, email: '' },
          { onConflict: 'phone', ignoreDuplicates: false }
        )
        .select('id')
        .single();
        
      if (!contact) continue;

      // Upsert conversation
      await supabase
        .from('conversations')
        .upsert(
          { contact_id: contact.id, status: 'human_active', zernio_conversation_id: conv.id },
          { onConflict: 'contact_id', ignoreDuplicates: true }
        );
      
      const { data: convData } = await supabase
        .from('conversations')
        .select('id')
        .eq('contact_id', contact.id)
        .single();
        
      if (convData) {
        // Fetch messages for this conversation
        const msgQ = new URLSearchParams({ conversationId: conv.id, sortOrder: "desc", limit: "50" });
        const msgsPage: any = await zfetch(ctx.apiKey, `/inbox/messages?${msgQ.toString()}`);
        const messages = Array.isArray(msgsPage?.data) ? msgsPage.data : [];
        
        for (const msg of messages) {
          if (!msg.id) continue;
          
          const isOut = msg.sender?.type === 'agent' || msg.direction === 'outbound';
          const text = msg.text || '';
          
          // Basic media mapping
          let mediaUrl = null;
          let contentType = 'text';
          if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
            mediaUrl = msg.attachments[0].url || null;
            const typeStr = (msg.attachments[0].type || '').toLowerCase();
            if (typeStr.includes('image')) contentType = 'image';
            else if (typeStr.includes('audio')) contentType = 'audio';
            else if (typeStr.includes('video')) contentType = 'video';
            else contentType = 'document';
          }
          
          await supabase.from('messages').upsert({
            conversation_id: convData.id,
            zernio_message_id: msg.id,
            direction: isOut ? 'outbound' : 'inbound',
            sender_type: isOut ? 'operator' : 'contact',
            content_type: contentType,
            content: text,
            media_url: mediaUrl,
            meta_status: isOut ? 'delivered' : null,
            is_private_note: false
          }, { onConflict: 'zernio_message_id', ignoreDuplicates: true });
        }
      }
      
      synced++;
    }

    return jsonResponse({ success: true, message: `Sync initiated, synced ${synced} conversations.` });
  } catch (error: any) {
    return jsonResponse({ error: error.message }, 500);
  }
});

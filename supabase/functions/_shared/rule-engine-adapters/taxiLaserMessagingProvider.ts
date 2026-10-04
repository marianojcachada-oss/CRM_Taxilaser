// supabase/functions/_shared/rule-engine-adapters/taxiLaserMessagingProvider.ts
//
// Implementacion REAL del puerto MessagingProvider para "Que tal?":
// envuelve sendAutomatedMessage (mismo mecanismo que ya usan los avisos
// automaticos de TaxiCaller) y deja guardado el mensaje en `messages`
// como automation_type "ai_response" -- mismo patron que el ai-respond
// actual, solo que ahora lo dispara el AIAgent via la Action del Rule
// Engine en vez de un unico llamado a Claude.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendAutomatedMessage } from "../automatedMessage.ts";
import type { MessagingProvider } from "../rule-engine/providers/MessagingProvider.ts";

export interface SentMessageInfo {
  conversationId: string;
  text: string;
  sentVia: string[];
  wamid?: string | null;
  rcMessageId?: string | null;
}

export class TaxiLaserMessagingProvider implements MessagingProvider {
  /** Guarda info del ultimo envio para que ai-respond/index.ts pueda loguearlo en ai_usage_log. */
  public lastSend: SentMessageInfo | null = null;

  constructor(
    private readonly client: SupabaseClient,
    private readonly contact: { id: string; phone: string },
  ) {}

  async send(conversationId: string, text: string): Promise<void> {
    const { sentVia, errors, wamid, rcMessageId } = await sendAutomatedMessage({
      contactId: this.contact.id,
      phone: this.contact.phone,
      text,
    });

    if (sentVia.length === 0) {
      throw new Error("No se pudo mandar el mensaje: " + JSON.stringify(errors));
    }

    await this.client.from("messages").insert({
      conversation_id: conversationId,
      sender_type: "operator",
      content: text,
      sent_via_channel: sentVia.join(",") || "whatsapp",
      automation_type: "ai_response",
      wamid,
      rc_message_id: rcMessageId,
      delivery_status: "sent",
    });

    this.lastSend = { conversationId, text, sentVia, wamid, rcMessageId };
  }
}

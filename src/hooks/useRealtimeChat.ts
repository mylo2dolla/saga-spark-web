import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { recordProfilesRead } from "@/ui/data/networkHealth";

type MessageType = "player" | "dm" | "system" | "roll";

export interface ChatMessage {
  id: string;
  campaign_id: string;
  user_id: string | null;
  message_type: MessageType;
  content: string;
  roll_data: {
    dice?: string;
    result?: number;
    modifier?: number;
    total?: number;
  } | null;
  created_at: string;
  profile?: {
    display_name: string;
    avatar_url: string | null;
  };
}

const MESSAGE_TYPES: MessageType[] = ["player", "dm", "system", "roll"];

const normalizeMessageType = (value: unknown): MessageType => {
  if (typeof value === "string" && MESSAGE_TYPES.includes(value as MessageType)) {
    return value as MessageType;
  }
  return "system";
};

const normalizeRollData = (value: unknown): ChatMessage["roll_data"] => {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const dice = typeof obj.dice === "string" ? obj.dice : undefined;
  const result = typeof obj.result === "number" ? obj.result : undefined;
  const modifier = typeof obj.modifier === "number" ? obj.modifier : undefined;
  const total = typeof obj.total === "number" ? obj.total : undefined;
  if (!dice && result === undefined && modifier === undefined && total === undefined) {
    return null;
  }
  return { dice, result, modifier, total };
};

export function useRealtimeChat(campaignId: string | undefined) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch initial messages
  useEffect(() => {
    if (!campaignId) return;
    let isMounted = true;

    const fetchMessages = async () => {
      try {
        if (isMounted) {
          setIsLoading(true);
        }
        
        const { data: messagesData, error } = await supabase
          .from("chat_messages")
          .select("*")
          .eq("campaign_id", campaignId)
          .order("created_at", { ascending: true })
          .limit(100);

        if (error) throw error;

        // Fetch profiles separately
        const userIds = messagesData?.filter(m => m.user_id).map(m => m.user_id) || [];
        const uniqueUserIds = [...new Set(userIds)];
        
        let profilesData: Array<{ user_id: string; display_name: string; avatar_url: string | null }> = [];
        if (uniqueUserIds.length > 0) {
          const { data } = await supabase
            .from("profiles")
            .select("user_id, display_name, avatar_url")
            .in("user_id", uniqueUserIds);
          profilesData = data || [];
          recordProfilesRead();
        }

        const messagesWithProfiles = (messagesData || []).map(msg => ({
          ...msg,
          message_type: normalizeMessageType(msg.message_type),
          roll_data: normalizeRollData(msg.roll_data),
          profile: profilesData.find(p => p.user_id === msg.user_id)
        })) as ChatMessage[];

        if (isMounted) {
          setMessages(messagesWithProfiles);
        }
      } catch (error) {
        console.error("Error fetching messages:", error);
        toast.error("Failed to load chat history");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchMessages();
    return () => {
      isMounted = false;
    };
  }, [campaignId]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!campaignId) return;
    let isMounted = true;

    const channel: RealtimeChannel = supabase
      .channel(`chat:${campaignId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `campaign_id=eq.${campaignId}`,
        },
        async (payload) => {
          const newMsg = payload.new as {
            id: string;
            campaign_id: string;
            user_id: string | null;
            message_type: string;
            content: string;
            roll_data: unknown;
            created_at: string;
          };

          // Fetch profile if user_id exists
          let profile: { display_name: string; avatar_url: string | null } | undefined;
          if (newMsg.user_id) {
            const { data } = await supabase
              .from("profiles")
              .select("display_name, avatar_url")
              .eq("user_id", newMsg.user_id)
              .maybeSingle();
            profile = data || undefined;
            recordProfilesRead();
          }

          const chatMessage: ChatMessage = {
            ...newMsg,
            message_type: normalizeMessageType(newMsg.message_type),
            roll_data: normalizeRollData(newMsg.roll_data),
            profile
          };

          if (isMounted) {
            setMessages(prev => (
              prev.some(message => message.id === chatMessage.id)
                ? prev
                : [...prev, chatMessage]
            ));
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [campaignId]);

  const sendMessage = useCallback(async (
    content: string,
    messageType: MessageType = "player",
    rollData?: ChatMessage["roll_data"]
  ) => {
    if (!campaignId) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("chat_messages")
        .insert({
          campaign_id: campaignId,
          user_id: user.id,
          message_type: messageType,
          content,
          roll_data: rollData,
        });

      if (error) throw error;
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error("Failed to send message");
      throw error;
    }
  }, [campaignId]);

  const sendDMMessage = useCallback(async (content: string, rollData?: ChatMessage["roll_data"]) => {
    if (!campaignId) return;

    try {
      const { error } = await supabase
        .from("chat_messages")
        .insert({
          campaign_id: campaignId,
          user_id: null,
          message_type: "dm",
          content,
          roll_data: rollData,
        });

      if (error) throw error;
    } catch (error) {
      console.error("Error sending DM message:", error);
      throw error;
    }
  }, [campaignId]);

  return {
    messages,
    isLoading,
    sendMessage,
    sendDMMessage,
  };
}

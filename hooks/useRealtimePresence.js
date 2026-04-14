import { useEffect, useRef, useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { hashColor } from '../lib/user-utils';

// Each tab gets a unique session ID so presence can distinguish
// multiple tabs opened by the same user (useful for solo testing).
function generateTabId() {
  return `tab-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

/**
 * useRealtimePresence — Subscribes to a Supabase Presence channel for a given
 * "room" (e.g., the dispatcher board) so the current user can see which other
 * users from the same tenant are viewing it live.
 *
 * The channel is also returned via `channelRef` so other hooks (like live
 * cursors) can piggyback broadcasts on the same connection without opening
 * a second WebSocket.
 *
 * @param {object} opts
 * @param {boolean} opts.enabled — toggle the subscription (e.g., feature flag)
 * @param {string} [opts.room='dispatcher'] — logical room key for the channel name
 * @returns {{ users: Array, channelRef: React.MutableRefObject, selfId: string|null }}
 */
export default function useRealtimePresence({ enabled = true, room = 'dispatcher' } = {}) {
  const { supabase, tenantId, profile } = useAuth();
  const [users, setUsers] = useState([]);
  const [channelReady, setChannelReady] = useState(false);
  const channelRef = useRef(null);

  // Stable tab ID for this hook instance — used as presence key so multiple
  // tabs/windows of the same user appear as separate presence entries.
  const tabId = useMemo(() => generateTabId(), []);

  useEffect(() => {
    if (!enabled || !supabase || !tenantId || !profile?.id) {
      setUsers([]);
      setChannelReady(false);
      return;
    }

    const selfTabId = tabId;
    const selfUserId = profile.id;
    const channelName = `presence-${room}-tenant-${tenantId}`;
    console.log('[Presence] subscribing', { channelName, tabId: selfTabId, userId: selfUserId });

    const channel = supabase.channel(channelName, {
      config: {
        presence: { key: selfTabId }, // per-tab key so solo testing works
        broadcast: { self: false }, // don't echo our own broadcasts back to us
      },
    });

    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        console.log('[Presence] sync, state:', state);
        // state shape: { tabId: [ { meta... } ] }
        const list = [];
        const seenUserIds = new Set();
        for (const key of Object.keys(state)) {
          const entries = state[key];
          if (!entries || entries.length === 0) continue;
          const latest = entries[entries.length - 1];
          // Exclude self by userId (so your own tabs never appear in the list)
          if (latest.userId === selfUserId) continue;
          // Dedupe by userId (if a teammate has multiple tabs open, show once)
          if (latest.userId && seenUserIds.has(latest.userId)) continue;
          if (latest.userId) seenUserIds.add(latest.userId);
          list.push({
            id: latest.userId || key,
            userId: latest.userId || key,
            tabId: key,
            name: latest.name,
            email: latest.email,
            avatar_url: latest.avatar_url || null,
            color: latest.color,
            joinedAt: latest.joinedAt,
          });
        }
        console.log('[Presence] visible users:', list);
        setUsers(list);
      })
      .subscribe(async (status) => {
        console.log('[Presence] subscribe status:', status);
        if (status === 'SUBSCRIBED') {
          // Announce our presence with identity metadata
          await channel.track({
            userId: selfUserId,
            tabId: selfTabId,
            name: profile.name || '',
            email: profile.email || '',
            avatar_url: profile.avatar_url || null,
            color: hashColor(selfUserId),
            joinedAt: Date.now(),
          });
          setChannelReady(true);
          console.log('[Presence] tracked self + channelReady=true');
        }
      });

    return () => {
      console.log('[Presence] unsubscribing');
      try {
        channel.untrack();
      } catch {}
      supabase.removeChannel(channel);
      channelRef.current = null;
      setChannelReady(false);
      setUsers([]);
    };
  }, [enabled, supabase, tenantId, profile?.id, profile?.name, profile?.email, room, tabId]);

  return { users, channelRef, channelReady, tabId, selfId: profile?.id || null };
}

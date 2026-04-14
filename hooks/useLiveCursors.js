import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { hashColor, firstName } from '../lib/user-utils';

const IDLE_TIMEOUT_MS = 3000;

/**
 * useLiveCursors — Broadcasts the current user's cursor position to other
 * users on the same channel, and tracks remote cursors received from them.
 *
 * Uses the Supabase Realtime BROADCAST API on an existing channel (provided
 * by useRealtimePresence) so both features share one WebSocket connection.
 *
 * Coordinates are computed in "content space" — relative to the scroll
 * container's inner content, not the viewport. This means remote cursors
 * appear at the same spot in the content regardless of the viewer's scroll.
 *
 * @param {object} opts
 * @param {boolean} opts.enabled
 * @param {React.MutableRefObject} opts.channelRef — from useRealtimePresence
 * @param {boolean} opts.channelReady — from useRealtimePresence; triggers re-run when channel is SUBSCRIBED
 * @param {React.RefObject<HTMLElement>} opts.scrollContainerRef — the board's
 *        scroll element; used to compute content-space coordinates and attach
 *        mousemove/mouseleave listeners
 * @param {string} opts.tabId — current tab's session id (to identify our broadcasts)
 * @param {Array} opts.users — presence users (for enriching cursor with name+color)
 * @returns {{ cursors: Array }}
 */
export default function useLiveCursors({ enabled = true, channelRef, channelReady = false, scrollContainerRef, tabId, users = [] } = {}) {
  const { profile } = useAuth();
  const [cursorMap, setCursorMap] = useState(() => new Map());
  const lastBroadcastRef = useRef(0);
  const pendingFrameRef = useRef(false);
  const lastPayloadRef = useRef(null);
  const usersByIdRef = useRef(new Map());

  // Keep a lookup of presence users (for name/color enrichment)
  // Keyed by both tabId AND userId so cursor events can resolve either way.
  useEffect(() => {
    const map = new Map();
    for (const u of users) {
      if (u.tabId) map.set(u.tabId, u);
      if (u.userId) map.set(u.userId, u);
    }
    usersByIdRef.current = map;
  }, [users]);

  // ============================================================
  // RECEIVE — listen for broadcast events on the channel
  // ============================================================
  useEffect(() => {
    if (!enabled || !channelReady) return;
    const channel = channelRef?.current;
    if (!channel || !tabId) return;

    console.log('[Cursors] attaching broadcast listener');

    channel.on('broadcast', { event: 'cursor' }, (msg) => {
      const payload = msg?.payload;
      if (!payload || !payload.tabId) return;
      // Skip ANY broadcast from the same user (even from their other tabs).
      // We never want a dispatcher to see their own cursor across tabs/screens.
      if (payload.userId && payload.userId === profile?.id) return;

      setCursorMap((prev) => {
        const next = new Map(prev);
        if (payload.x == null || payload.y == null) {
          next.delete(payload.tabId);
        } else {
          next.set(payload.tabId, {
            tabId: payload.tabId,
            userId: payload.userId,
            x: payload.x,
            y: payload.y,
            lastSeen: Date.now(),
          });
        }
        return next;
      });
    });

    return () => {
      // supabase-js v2 doesn't expose .off for specific handlers on broadcast;
      // removing the channel entirely is handled by useRealtimePresence unmount.
    };
  }, [enabled, channelReady, channelRef, tabId]);

  // ============================================================
  // SEND — broadcast local mouse position (rAF-throttled)
  // ============================================================
  useEffect(() => {
    if (!enabled || !channelReady) return;
    const container = scrollContainerRef?.current;
    if (!container || !profile?.id || !tabId) {
      console.log('[Cursors] send effect bailing:', {
        container: !!container,
        profileId: profile?.id,
        tabId,
      });
      return;
    }

    console.log('[Cursors] attaching mousemove listener');
    const selfUserId = profile.id;
    const selfTabId = tabId;

    function flush() {
      pendingFrameRef.current = false;
      const payload = lastPayloadRef.current;
      if (!payload) return;
      const channel = channelRef?.current;
      if (!channel) return;
      try {
        channel.send({ type: 'broadcast', event: 'cursor', payload });
      } catch (err) {
        console.warn('[Cursors] send failed', err);
      }
      lastBroadcastRef.current = Date.now();
    }

    function handleMove(e) {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left + container.scrollLeft;
      const y = e.clientY - rect.top + container.scrollTop;
      lastPayloadRef.current = { userId: selfUserId, tabId: selfTabId, x, y };
      if (!pendingFrameRef.current) {
        pendingFrameRef.current = true;
        requestAnimationFrame(flush);
      }
    }

    function handleLeave() {
      lastPayloadRef.current = { userId: selfUserId, tabId: selfTabId, x: null, y: null };
      const channel = channelRef?.current;
      if (!channel) return;
      try {
        channel.send({ type: 'broadcast', event: 'cursor', payload: lastPayloadRef.current });
      } catch {}
    }

    container.addEventListener('mousemove', handleMove);
    container.addEventListener('mouseleave', handleLeave);
    return () => {
      container.removeEventListener('mousemove', handleMove);
      container.removeEventListener('mouseleave', handleLeave);
    };
  }, [enabled, channelReady, scrollContainerRef, channelRef, profile?.id, tabId]);

  // ============================================================
  // IDLE EXPIRY — drop cursors that haven't updated in 3s
  // ============================================================
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      setCursorMap((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [userId, cursor] of next) {
          if (now - cursor.lastSeen > IDLE_TIMEOUT_MS) {
            next.delete(userId);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 500);
    return () => clearInterval(interval);
  }, [enabled]);

  // ============================================================
  // Build cursor list with name/color joined from presence users
  // ============================================================
  const cursors = [];
  for (const [tabKey, c] of cursorMap) {
    const user = usersByIdRef.current.get(tabKey) || usersByIdRef.current.get(c.userId);
    cursors.push({
      tabId: tabKey,
      userId: c.userId,
      x: c.x,
      y: c.y,
      name: firstName(user?.name, user?.email),
      color: user?.color || hashColor(c.userId),
    });
  }

  return { cursors };
}

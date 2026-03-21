import type { Channel } from '../types.js';
import { logger } from '../logger.js';

export function createTvOnlyPlaceholderChannel(): Channel {
  let connected = false;
  return {
    name: 'tvclaw-tv-only',
    async connect() {
      connected = true;
    },
    async disconnect() {
      connected = false;
    },
    isConnected() {
      return connected;
    },
    ownsJid() {
      return false;
    },
    async sendMessage(_jid: string, text: string) {
      logger.debug(
        { len: text.length },
        'tv-only channel: outbound not delivered (add a chat channel for WhatsApp, etc.)',
      );
    },
  };
}

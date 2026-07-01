import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import crypto from 'crypto'
import { OAuth2Client } from 'google-auth-library'
import { CHECKBOX_COUNT, CHECKBOX_STATE_KEY, CHANNEL, GUEST_TTL } from './constant.js'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: resolve(__dirname, '.env') })

import { publisher, redis, subscriber } from './redis-connection.js'

redis.on('error', err => console.error('Redis Error:', err));
publisher.on('error', err => console.error('Publisher Error:', err));
subscriber.on('error', err => console.error('Subscriber Error:', err));

async function enableKeyspaceNotifications() {
  try {
    await redis.config('SET', 'notify-keyspace-events', 'Ex');
    console.log('Redis Keyspace Notifications enabled.');
  } catch (error) {
    console.warn('Could not run CONFIG SET notify-keyspace-events Ex. Make sure expiry notifications are enabled manually.', error);
  }
}

redis.on('ready', enableKeyspaceNotifications);
if (redis.status === 'ready') {
  enableKeyspaceNotifications();
}

// Register the atomic toggleCheckbox Lua script
redis.defineCommand('toggleCheckbox', {
  numberOfKeys: 2,
  lua: `
    local checkbox_key = KEYS[1]
    local owner_key = KEYS[2]
    local index = tonumber(ARGV[1])
    local is_checked = tonumber(ARGV[2])
    local user_info_json = ARGV[3]
    local current_user_id = ARGV[4]
    local ttl_seconds = tonumber(ARGV[5])
    local current_time = tonumber(ARGV[6])

    local current_bit = redis.call('getbit', checkbox_key, index)

    if is_checked == 1 then
      if current_bit == 1 then
        local owner_data = redis.call('get', owner_key)
        if owner_data then
          local owner = cjson.decode(owner_data)
          if owner.isGuest == true then
            -- Allow overwriting/upgrading guest checkboxes
            redis.call('set', owner_key, user_info_json)
            if ttl_seconds > 0 then
              redis.call('expire', owner_key, ttl_seconds)
              redis.call('zadd', 'guest_checkbox_expiries', current_time + (ttl_seconds * 1000), index)
            else
              redis.call('persist', owner_key)
              redis.call('zrem', 'guest_checkbox_expiries', index)
            end
            local click_count = redis.call('get', 'global_click_count')
            return {1, user_info_json, click_count and tonumber(click_count) or 0}
          else
            -- Authenticated checkbox: only same user can refresh
            local owner_id = owner.userId
            if owner_id == current_user_id then
              redis.call('set', owner_key, user_info_json)
              if ttl_seconds > 0 then
                redis.call('expire', owner_key, ttl_seconds)
                redis.call('zadd', 'guest_checkbox_expiries', current_time + (ttl_seconds * 1000), index)
              else
                redis.call('persist', owner_key)
                redis.call('zrem', 'guest_checkbox_expiries', index)
              end
              local click_count = redis.call('get', 'global_click_count')
              return {1, owner_data, click_count and tonumber(click_count) or 0}
            else
              local click_count = redis.call('get', 'global_click_count')
              return {0, owner_data, click_count and tonumber(click_count) or 0}
            end
          end
        else
          redis.call('set', owner_key, user_info_json)
          if ttl_seconds > 0 then
            redis.call('expire', owner_key, ttl_seconds)
            redis.call('zadd', 'guest_checkbox_expiries', current_time + (ttl_seconds * 1000), index)
          else
            redis.call('persist', owner_key)
            redis.call('zrem', 'guest_checkbox_expiries', index)
          end
          local click_count = redis.call('get', 'global_click_count')
          return {1, user_info_json, click_count and tonumber(click_count) or 0}
        end
      else
        redis.call('setbit', checkbox_key, index, 1)
        redis.call('set', owner_key, user_info_json)
        if ttl_seconds > 0 then
          redis.call('expire', owner_key, ttl_seconds)
          redis.call('zadd', 'guest_checkbox_expiries', current_time + (ttl_seconds * 1000), index)
        else
          redis.call('persist', owner_key)
          redis.call('zrem', 'guest_checkbox_expiries', index)
        end
        local click_count = redis.call('incr', 'global_click_count')
        return {1, user_info_json, tonumber(click_count)}
      end
    else
      if current_bit == 0 then
        redis.call('del', owner_key)
        redis.call('zrem', 'guest_checkbox_expiries', index)
        local click_count = redis.call('get', 'global_click_count')
        return {1, nil, click_count and tonumber(click_count) or 0}
      else
        local owner_data = redis.call('get', owner_key)
        if owner_data then
          local owner = cjson.decode(owner_data)
          if owner.isGuest == true then
            -- Anyone can uncheck guest checkboxes!
            redis.call('setbit', checkbox_key, index, 0)
            redis.call('del', owner_key)
            redis.call('zrem', 'guest_checkbox_expiries', index)
            local click_count = redis.call('incr', 'global_click_count')
            return {1, owner_data, tonumber(click_count)}
          else
            -- Authenticated user: only the same owner can uncheck it!
            local owner_id = owner.userId
            if owner_id == current_user_id then
              redis.call('setbit', checkbox_key, index, 0)
              redis.call('del', owner_key)
              redis.call('zrem', 'guest_checkbox_expiries', index)
              local click_count = redis.call('incr', 'global_click_count')
              return {1, owner_data, tonumber(click_count)}
            else
              local click_count = redis.call('get', 'global_click_count')
              return {0, owner_data, click_count and tonumber(click_count) or 0}
            end
          end
        else
          redis.call('setbit', checkbox_key, index, 0)
          redis.call('del', owner_key)
          redis.call('zrem', 'guest_checkbox_expiries', index)
          local click_count = redis.call('incr', 'global_click_count')
          return {1, nil, tonumber(click_count)}
        end
      end
    end
  `
});


// Normalize frontend URL (strip surrounding quotes and trailing slashes)
const rawFrontendUrl = process.env.VITE_FRONTEND_URL || 'http://localhost:5173'
const FRONTEND_URL = rawFrontendUrl.replace(/^['"]|['"]$/g, '').replace(/\/+$/, '')

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ? process.env.GOOGLE_CLIENT_ID.replace(/^['"]|['"]$/g, '').trim() : null;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ? process.env.GOOGLE_CLIENT_SECRET.replace(/^['"]|['"]$/g, '').trim() : null;

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.warn("⚠️ Google SSO environment variables (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) are missing or incomplete. Google SSO is disabled. Using Mock Sandbox Auth fallback.");
} else {
  console.log("✅ Google SSO credentials successfully loaded.");
}

const client = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// Parse cookie header manually for Socket.io authentication
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const parts = c.split('=');
    if (parts.length >= 2) {
      cookies[parts[0].trim()] = decodeURIComponent(parts[1].trim());
    }
  });
  return cookies;
}

async function main() {
  const PORT = process.env.VITE_PORT || 8000;
  const isProduction = process.env.NODE_ENV === 'production';

  const app = express()
  app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    next();
  });
  app.use(cors({
    credentials: true,
    origin: FRONTEND_URL,
    methods: ['GET', 'POST']
  }))
  app.use(express.json())
  app.use(cookieParser())

  app.get('/health', (_, res) => {
    res.status(200).json({ message: "good health" })
  })

  // Auth Configuration Check
  app.get('/api/auth/config', (req, res) => {
    res.json({
      googleConfigured: !!GOOGLE_CLIENT_ID,
      googleClientId: GOOGLE_CLIENT_ID || null
    });
  });

  // Google SSO Login
  app.post('/api/auth/google', async (req, res) => {
    try {
      const { credential } = req.body;
      if (!credential) {
        return res.status(400).json({ error: 'No credential provided' });
      }

      if (!client) {
        return res.status(500).json({ error: 'Google authentication is not configured on the server.' });
      }

      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      
      const user = {
        id: `google-${payload.sub}`,
        name: payload.name,
        email: payload.email,
        picture: payload.picture
      };

      const sessionToken = crypto.randomUUID();
      // Store session in Redis for 7 days (604800 seconds)
      await redis.set(`session:${sessionToken}`, JSON.stringify(user), 'EX', 604800);

      res.cookie('session_token', sessionToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });

      return res.json({ success: true, user });
    } catch (error) {
      console.error('Google SSO Error:', error);
      return res.status(401).json({ error: 'Invalid Google credential' });
    }
  });


  // Check Session
  app.get('/api/auth/session', async (req, res) => {
    try {
      const token = req.cookies.session_token;
      if (!token) {
        return res.json({ authenticated: false });
      }

      const sessionData = await redis.get(`session:${token}`);
      if (!sessionData) {
        return res.json({ authenticated: false });
      }

      return res.json({
        authenticated: true,
        user: JSON.parse(sessionData)
      });
    } catch (error) {
      console.error('Session check error:', error);
      return res.status(500).json({ error: 'Session check failed' });
    }
  });

  // Logout
  app.post('/api/auth/logout', async (req, res) => {
    try {
      const token = req.cookies.session_token;
      if (token) {
        await redis.del(`session:${token}`);
      }

      res.clearCookie('session_token', {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax'
      });

      return res.json({ success: true });
    } catch (error) {
      console.error('Logout error:', error);
      return res.status(500).json({ error: 'Logout failed' });
    }
  });

  // Fetch all checkbox states (base64 bitfield) and global click count
  app.get('/checkboxes', async (req, res) => {
    try {
      const [buffer, clickCount] = await Promise.all([
        redis.getBuffer(CHECKBOX_STATE_KEY),
        redis.get('global_click_count')
      ]);
      const base64 = buffer ? buffer.toString('base64') : '';

      return res.json({
        base64,
        total: CHECKBOX_COUNT,
        clickCount: clickCount ? parseInt(clickCount, 10) : 0
      });
    } catch (error) {
      console.error('Error fetching checkboxes:', error);
      return res.status(500).json({ error: 'Failed to fetch checkboxes' });
    }
  })

  const server = http.createServer(app)
  const io = new Server(server, {
    cors: {
      credentials: true,
      origin: FRONTEND_URL,
      methods: ['GET', 'POST']
    }
  })

  // Valkey Keyspace Notifications are configured at connection ready handler

  // Subscribe to internal checkbox sync channel & database expired events
  const dbIndex = redis.options.db || 0;
  const expiredChannel = `__keyevent@${dbIndex}__:expired`;

  await subscriber.subscribe(CHANNEL);
  await subscriber.subscribe(expiredChannel);

  subscriber.on('message', async (channel, message) => {
    try {
      if (channel === expiredChannel) {
        if (message.startsWith('checkbox:expiry:')) {
          const index = parseInt(message.split(':')[2], 10);
          if (!isNaN(index)) {
            // Atomically set bit to 0. setbit returns the old value.
            // If the old value was 1, it means this was checked and we are the first to handle its expiry.
            const oldVal = await redis.setbit(CHECKBOX_STATE_KEY, index, 0);
            if (oldVal === 1) {
              // Broadcast reset event to all backend instances
              publisher.publish(CHANNEL, JSON.stringify({ index, isChecked: false }));
            }
          }
        }
      } else if (channel === CHANNEL) {
        const { index, isChecked, clickCount, owner } = JSON.parse(message);
        io.emit('server:checkbox:change', { index, isChecked, clickCount, owner });
      }
    } catch (error) {
      console.error('Subscriber Message Error:', error);
    }
  });

  // Socket.io Middleware to Authenticate Session Cookie or Establish Guest Session
  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie;
      const cookies = parseCookies(cookieHeader);
      const sessionToken = cookies['session_token'];
      if (!sessionToken) {
        const guestId = socket.handshake.auth?.guestSessionId || `guest-${socket.id.substring(0, 8)}`;
        socket.user = {
          id: guestId,
          name: 'Guest User',
          isGuest: true
        };
        return next();
      }

      const sessionData = await redis.get(`session:${sessionToken}`);
      if (!sessionData) {
        const guestId = socket.handshake.auth?.guestSessionId || `guest-${socket.id.substring(0, 8)}`;
        socket.user = {
          id: guestId,
          name: 'Guest User',
          isGuest: true
        };
        return next();
      }

      socket.user = {
        ...JSON.parse(sessionData),
        isGuest: false
      };
      next();
    } catch (error) {
      console.error('Socket authentication failed:', error);
      const guestId = socket.handshake.auth?.guestSessionId || `guest-${socket.id.substring(0, 8)}`;
      socket.user = {
        id: guestId,
        name: 'Guest User',
        isGuest: true
      };
      next();
    }
  });

  let userCount = 0;
  io.on('connection', (socket) => {
    userCount++;
    io.emit("online:users", userCount)

    socket.on("disconnect", () => {
      userCount--;
      io.emit("online:users", userCount)
    })

    // Handle Checkbox Change
    socket.on('client:checkbox:change', async ({ isChecked, index }) => {
      try {
        const ownerKey = `checkbox:expiry:${index}`;
        const currentUserId = socket.user?.id || socket.id;
        
        let userInfo = {};
        let ttlSeconds = 0;
        
        if (socket.user && !socket.user.isGuest) {
          userInfo = {
            name: socket.user.name,
            picture: socket.user.picture,
            userId: socket.user.id,
            isGuest: false
          };
          ttlSeconds = 0; // Permanent
        } else {
          userInfo = {
            name: 'Guest User',
            guestId: currentUserId.substring(0, 8),
            guestSessionId: currentUserId, // full session ID for authorization, strip before broadcasting
            isGuest: true
          };
          ttlSeconds = GUEST_TTL;
        }

        const userInfoJson = JSON.stringify(userInfo);

        // Run the Lua script atomically on Redis
        const [successCode, ownerDataJson, clickCount] = await redis.toggleCheckbox(
          CHECKBOX_STATE_KEY,
          ownerKey,
          index,
          isChecked ? 1 : 0,
          userInfoJson,
          currentUserId,
          ttlSeconds,
          Date.now()
        );

        const success = successCode === 1;

        if (success) {
          // Strip private guest session ID before broadcasting
          let ownerToSend = null;
          if (isChecked) {
            ownerToSend = { ...userInfo };
            delete ownerToSend.guestSessionId;
          }

          // Publish event to Redis channel for multi-server sync
          publisher.publish(CHANNEL, JSON.stringify({
            index,
            isChecked,
            clickCount,
            owner: ownerToSend
          }));
        } else {
          // Reject action: notify the socket and revert state
          let currentOwner = null;
          if (ownerDataJson) {
            try {
              currentOwner = JSON.parse(ownerDataJson);
              delete currentOwner.guestSessionId;
            } catch (e) {}
          }

          socket.emit('server:checkbox:rejected', {
            index,
            isChecked: !isChecked, // Revert to previous state
            owner: currentOwner,
            clickCount
          });
        }
      } catch (error) {
        console.error('Error updating checkbox:', error);
        socket.emit('server:error', { error: 'Failed to update checkbox' });
      }
    })

    // Handle Hover Lookup (On-Demand)
    socket.on('client:checkbox:hover', async ({ index }) => {
      try {
        const key = `checkbox:expiry:${index}`;
        const results = await redis.pipeline()
          .get(key)
          .ttl(key)
          .exec();

        const userJson = results[0][1];
        const ttl = results[1][1];

        if (!userJson) {
          // Self-healing / lazy cleanup: if the bit is 1 but key is missing, clean it
          const bitVal = await redis.getbit(CHECKBOX_STATE_KEY, index);
          if (bitVal === 1) {
            await redis.setbit(CHECKBOX_STATE_KEY, index, 0);
            publisher.publish(CHANNEL, JSON.stringify({ index, isChecked: false }));
            socket.emit('server:checkbox:hover', {
              index,
              user: null,
              ttl: 0
            });
            return;
          }
        }

        const user = userJson ? JSON.parse(userJson) : null;
        if (user) {
          delete user.guestSessionId; // Strip sensitive guest session ID
        }

        socket.emit('server:checkbox:hover', {
          index,
          user,
          ttl: ttl > 0 ? ttl : 0
        });
      } catch (error) {
        console.error('Error handling hover event:', error);
      }
    });
  })

  // Active background sweeper for guest checkbox expirations (runs every 1 second)
  setInterval(async () => {
    try {
      const now = Date.now();
      // Atomically query and remove expired elements from the sorted set
      const expiredIndices = await redis.eval(`
        local expired = redis.call('zrangebyscore', KEYS[1], 0, ARGV[1])
        if #expired > 0 then
          redis.call('zremrangebyscore', KEYS[1], 0, ARGV[1])
        end
        return expired
      `, 1, 'guest_checkbox_expiries', now);

      if (expiredIndices && expiredIndices.length > 0) {
        for (const indexStr of expiredIndices) {
          const index = parseInt(indexStr, 10);
          if (!isNaN(index)) {
            const oldVal = await redis.setbit(CHECKBOX_STATE_KEY, index, 0);
            await redis.del(`checkbox:expiry:${index}`);
            if (oldVal === 1) {
              publisher.publish(CHANNEL, JSON.stringify({ index, isChecked: false }));
            }
          }
        }
      }
    } catch (err) {
      console.error('Error in guest checkbox expiration sweeper:', err);
    }
  }, 1000);

  server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  })
}

main();

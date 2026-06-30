import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import crypto from 'crypto'
import { OAuth2Client } from 'google-auth-library'
import { CHECKBOX_COUNT, CHECKBOX_STATE_KEY, CHANNEL } from './constant.js'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: resolve(__dirname, '.env') })

// Import redis connection after loading env
import { publisher, redis, subscriber } from './redis-connection.js'

redis.on('error', err => console.error('Redis Error:', err));
publisher.on('error', err => console.error('Publisher Error:', err));
subscriber.on('error', err => console.error('Subscriber Error:', err));

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

  // Mock Sandbox Login
  app.post('/api/auth/mock', async (req, res) => {
    try {
      const { name } = req.body;
      const username = name?.trim() || 'Guest Developer';

      const user = {
        id: `mock-${crypto.randomUUID().substring(0, 8)}`,
        name: username,
        email: 'sandbox@local.dev',
        picture: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(username)}`
      };

      const sessionToken = crypto.randomUUID();
      await redis.set(`session:${sessionToken}`, JSON.stringify(user), 'EX', 604800);

      res.cookie('session_token', sessionToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000
      });

      return res.json({ success: true, user });
    } catch (error) {
      console.error('Mock Login Error:', error);
      return res.status(500).json({ error: 'Mock login failed' });
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

  // Configure Redis Keyspace Notifications for TTL expiry
  try {
    await redis.config('SET', 'notify-keyspace-events', 'Ex');
    console.log('Redis Keyspace Notifications enabled.');
  } catch (error) {
    console.warn('Could not run CONFIG SET notify-keyspace-events Ex. Make sure expiry notifications are enabled manually.', error);
  }

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
        const { index, isChecked, clickCount } = JSON.parse(message);
        io.emit('server:checkbox:change', { index, isChecked, clickCount });
      }
    } catch (error) {
      console.error('Subscriber Message Error:', error);
    }
  });

  // Socket.io Middleware to Authenticate Session Cookie
  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie;
      const cookies = parseCookies(cookieHeader);
      const sessionToken = cookies['session_token'];
      if (!sessionToken) {
        return next(new Error('Authentication error: No session token'));
      }

      const sessionData = await redis.get(`session:${sessionToken}`);
      if (!sessionData) {
        return next(new Error('Authentication error: Invalid session'));
      }

      socket.user = JSON.parse(sessionData);
      next();
    } catch (error) {
      console.error('Socket authentication failed:', error);
      next(new Error('Authentication error'));
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
        const pipeline = redis.pipeline();
        pipeline.setbit(CHECKBOX_STATE_KEY, index, isChecked ? 1 : 0);
        pipeline.incr('global_click_count');

        if (isChecked) {
          // Store check info with 5-minute TTL
          pipeline.set(`checkbox:expiry:${index}`, JSON.stringify({
            name: socket.user.name,
            picture: socket.user.picture
          }), 'EX', 300);
        } else {
          // Remove hover info and TTL
          pipeline.del(`checkbox:expiry:${index}`);
        }

        const results = await pipeline.exec();
        const newClickCount = results[1][1]; // result of incr is the 2nd command

        // Publish event to Redis channel for multi-server sync
        publisher.publish(CHANNEL, JSON.stringify({ index, isChecked, clickCount: newClickCount }));
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

        const user = userJson ? JSON.parse(userJson) : null;
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

  server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  })
}

main();

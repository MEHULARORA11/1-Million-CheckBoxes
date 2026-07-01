import { Redis } from 'ioredis';

const redis = new Redis('redis://localhost:6379');
const subscriber = new Redis('redis://localhost:6379');

async function test() {
  try {
    const configResult = await redis.config('SET', 'notify-keyspace-events', 'Ex');
    console.log('CONFIG SET result:', configResult);

    const dbIndex = redis.options.db || 0;
    const expiredChannel = `__keyevent@${dbIndex}__:expired`;
    console.log('Subscribing to:', expiredChannel);

    subscriber.on('message', (channel, message) => {
      console.log(`Received message on channel [${channel}]:`, message);
    });

    await subscriber.subscribe(expiredChannel);

    console.log('Setting test key with 2s TTL...');
    await redis.set('checkbox:expiry:999', 'test-user', 'EX', 2);

    setTimeout(async () => {
      console.log('Checking test key value in Redis after 3s...');
      const val = await redis.get('checkbox:expiry:999');
      console.log('Value is:', val);
      
      // Clean up
      subscriber.disconnect();
      redis.disconnect();
    }, 4000);

  } catch (error) {
    console.error('Test error:', error);
  }
}

test();

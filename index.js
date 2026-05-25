import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { CHECKBOX_COUNT, CHECKBOX_STATE_KEY, CHANNEL } from './constant.js'
import { publisher, redis, subscriber } from './redis-connection.js'
import 'dotenv/config'


const FRONTEND_URL = process.env.VITE_FRONTEND_URL
// console.log(FRONTEND_URL)

// const state = {
//     checked:new Array(CHECKBOX_COUNT).fill(false)
// }

async function main() {
  const PORT = process.env.VITE_PORT

  const app = express()
  app.use(cors({
    credentials: true,
    origin: FRONTEND_URL,
  }))


  app.get('/checkboxes', async (req, res) => {
    try {
      // Use getBuffer to fetch all 1 million bits instantly
      const buffer = await redis.getBuffer(CHECKBOX_STATE_KEY);
      const base64 = buffer ? buffer.toString('base64') : '';

      return res.json({
        base64,
        total: CHECKBOX_COUNT
      });
    } catch (error) {
      console.error('Error fetching checkboxes:', error);
      return res.status(500).json({ error: 'Failed to fetch checkboxes' });
    }
  })

  const server = http.createServer(app)
  const io = new Server(server, {
    cors: { // now by this syntax , we don't need io.attatch()
      // we can also do this thing in io.attach by io.attach(server,{cors:{}})
      credentials: true,
      origin: FRONTEND_URL
    }
  })
  await subscriber.subscribe(CHANNEL)
  subscriber.on('message', (channel, message) => {
    if (channel === CHANNEL) {
      const { index, isChecked } = JSON.parse(message)
      io.emit('server:checkbox:change', { index, isChecked })
    }
  })
  ///////////////////////

  io.on('connection', (socket) => {
    console.log(socket.id)
    socket.on('client:checkbox:change', async ({ isChecked, index }) => {
      try {
        // Use lowercase 'setbit' for ioredis
        await redis.setbit(CHECKBOX_STATE_KEY, index, isChecked ? 1 : 0);

        // Publish to other servers
        publisher.publish(CHANNEL, JSON.stringify({ index, isChecked }));
      } catch (error) {
        console.error('Error updating checkbox:', error);
        socket.emit('server:error', { error: 'Failed to update checkbox' });
      }
    })
  })

  //   io.attach(server);

  //   io.on('connection',(socket) => {
  //     console.log(socket.id); 
  //     socket.on('client:checkbox:change',({isChecked,index}) => {
  //         socket.emit('server:change',{isChecked,index})        
  //     })
  //   })

  server.listen(PORT, () => {
    console.log(`Server is running on http:localhost:${PORT}`);
  })
}

main();

// first send an emit ebvent from client when the toggle is done
// then handle it on backend and make sure to update the state and then broadcast.emit it and  handle that event in client  
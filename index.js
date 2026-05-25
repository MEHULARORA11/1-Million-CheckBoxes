import express from 'express'
import http from 'http'
import {Server} from 'socket.io'
import cors from 'cors'
import {CHECKBOX_COUNT,CHECKBOX_STATE_KEY} from './constant.js'
import {publisher,redis,subscriber} from './redis-connection.js'
import 'dotenv/config'

// const state = {
//     checked:new Array(CHECKBOX_COUNT).fill(false)
// }

async function main(){
    const PORT = process.env.VITE_PORT
    
    const app = express()
    app.use(cors({
        credentials:true,
        origin:[
            'http://localhost:5173',
            'http://localhost:5174',
            'http://localhost:5175'
        ],
    }))

 
    app.get('/checkboxes',async(req,res) => {
        const existingState = await redis.get(CHECKBOX_STATE_KEY)
        if(existingState){
            const remoteData = JSON.parse(existingState)
            return res.json(remoteData)
        }
        return res.json({checkboxes:new Array(CHECKBOX_COUNT).fill(false)})
    })

  const server = http.createServer(app)
  const io = new Server(server,{
    cors:{ // now by this syntax , we don't need io.attatch()
        // we can also do this thing in io.attach by io.attach(server,{cors:{}})
        credentials:true,
        origin:['http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:5175'
        ]
    } 
  })
//////////////////////////
  await subscriber.subscribe('internal:server:checkbox:change')
  subscriber.on('message',(channel,message) => {
    if(channel === 'internal:server:checkbox:change'){
        const {index,isChecked} = JSON.parse(message)
        io.emit('server:checkbox:change',{index,isChecked})
    }
  })
///////////////////////

  io.on('connection',(socket) => {
    console.log(socket.id)
    socket.on('client:checkbox:change',async({isChecked,index}) => {
        console.log(isChecked,index);
        // state.checked[index] = isChecked
        // socket.broadcast.emit('server:checkbox:change',{isChecked,index})  
        const existingState = await redis.get(CHECKBOX_STATE_KEY)
        if(existingState){
            const remoteData = JSON.parse(existingState)
            remoteData.checkboxes[index] = isChecked
            await redis.set(CHECKBOX_STATE_KEY,JSON.stringify(remoteData))
        }else{
            const initialState = {
                checkboxes:new Array(CHECKBOX_COUNT).fill(false)
            }
            initialState.checkboxes[index] = isChecked
            await redis.set(CHECKBOX_STATE_KEY,JSON.stringify(initialState))
        }
        publisher.publish('internal:server:checkbox:change',JSON.stringify({index,isChecked}) ) 
    })
    // we input channel name in it
  })
   
//   io.attach(server);

//   io.on('connection',(socket) => {
//     console.log(socket.id); 
//     socket.on('client:checkbox:change',({isChecked,index}) => {
//         socket.emit('server:change',{isChecked,index})        
//     })
//   })

  server.listen(PORT,() => {
    console.log(`Server is running on http:localhost:${PORT}`);    
  })
}

main();

// first send an emit ebvent from client when the toggle is done 
// then handle it on backend and make sure to update the state and then broadcast.emit it and  handle that event in client  
import express from 'express'
import http from 'http'
import {Server} from 'socket.io'
import cors from 'cors'
import {CHECKBOX_COUNT} from './constant.js'

const state = {
    checked:new Array(CHECKBOX_COUNT).fill(false)
}

async function main(){
    const PORT = process.env.PORT ?? 8000
    const app = express()
    app.use(cors({
        credentials:true,
        origin:'http://localhost:5173',
    }))

    app.get('/checkboxes',(req,res) => {
      res.json(state.checked)
    })

  const server = http.createServer(app)
  const io = new Server(server,{
    cors:{ // now by this syntax , we don't need io.attatch()
        // we can also do this thing in io.attach by io.attach(server,{cors:{}})
        credentials:true,
        origin:'http://localhost:5173'
    }
  })

  io.on('connection',(socket) => {
    console.log(socket.id)
    socket.on('client:checkbox:change',({isChecked,index}) => {
        console.log(isChecked,index);
        state.checked[index] = isChecked
        socket.broadcast.emit('server:checkbox:change',{isChecked,index})    
    })
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
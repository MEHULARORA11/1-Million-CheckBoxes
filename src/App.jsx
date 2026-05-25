// for react we need =>npm install socket.io-client
import {io} from 'socket.io-client'
import {CHECKBOX_COUNT} from '../constant.js'
import { useState,useEffect} from 'react';
 const PORT = import.meta.env.VITE_PORT
const socket = io(`http://localhost:${PORT}`,{
      transports:['websocket'] // "Don't use polling at all.
// Directly use WebSocket."
    });
  
/**
 * Example:

Suppose user refreshes 3 times:

1st socket id → A1
refresh
2nd socket id → B7
refresh
3rd socket id → K9

Old sockets disconnect automatically.

So only ONE active socket remains.
 * 
 */
function App(){
 

 const [checked,setChecked] = useState(new Array(CHECKBOX_COUNT).fill(false))

 useEffect(() => {
  
    async function getState(){
   const data = await fetch(`http://localhost:${PORT}/checkboxes`)
   const response = await data.json()
   // response is { checkboxes: [...] }
   setChecked(response.checkboxes)
}
getState()
  
 },[])

 useEffect(() => {
   socket.on('server:checkbox:change',({isChecked,index}) => {
     setChecked((prevChecked) => {
       const newChecked = [...prevChecked]
       newChecked[index] = isChecked
       return newChecked
     })
   })

   // Cleanup listener on unmount
   return () => {
     socket.off('server:checkbox:change')
   }
 },[])

  function handleChange(index){
 return (e) => {
  const isChecked = e.target.checked
  socket.emit('client:checkbox:change',{isChecked,index})
  setChecked((prevChecked) => {
    const newChecked = [...prevChecked]
    newChecked[index] = isChecked
    return newChecked
  })
 }
  }

 return (
  <>
  <h1 style = {{color:'white'}} >Checkboxes</h1>
  {new Array(CHECKBOX_COUNT).fill(null).map((_,index) => {
    return <input key = {index} type = "checkbox" onChange={handleChange(index)}  checked = {checked[index]}></input>
  })}
  </>
 )
}

export default App
import {Redis} from 'ioredis'
import 'dotenv/config'


const REDIS_URL = process.env.VITE_REDIS_URL
// console.log(REDIS_URL)

// function createNewRedisConnection(){
//     return new Redis({
//         host:REDIS_URL,
//         port:6379
//     })
// }
function createNewRedisConnection(){
    return new Redis(REDIS_URL)
}

export const redis = createNewRedisConnection();
export const publisher = createNewRedisConnection();
export const subscriber = createNewRedisConnection();
